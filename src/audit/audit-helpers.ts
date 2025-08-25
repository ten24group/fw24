import { AuditLoggerFactory } from './loggers/factory';
import { AuditEntry } from './interfaces';
import { ExecutionContext } from '../core/types/execution-context';
import { Actor } from '../core/types/actor';
import { createLogger } from '../logging';

const logger = createLogger('AuditHelpers');

/**
 * Simple audit helper that auto-extracts context from ExecutionContext
 */
export async function captureAuditLog(options: {
    eventType: string;                    // What happened: 'login', 'payment_failed', 'file_upload'
    entityName?: string;                  // Entity type: 'auth', 'payment', 'user' (auto-detected from context if not provided)
    severity?: 'info' | 'warn' | 'error' | 'critical'; // Auto-determined from success if not provided
    success?: boolean;                    // Whether the operation succeeded (auto-determines severity if not provided)
    timestamp?: string;                   // Optional timestamp (ISO string), auto-generated if not provided
    ctx?: ExecutionContext;               // Framework context (auto-extracts actor, request info)
    data?: Record<string, any>;           // Event-specific data
    entity?: any;                         // Full entity state (for deletes, updates)
    identifiers?: Record<string, any>;    // Pre-extracted identifiers (preferred over entity)
}): Promise<void> {
    try {
        const auditLogger = AuditLoggerFactory.getInstance().create();
        const actor = options.ctx?.actor;
        
        const severity = options.severity ?? 'info';
        const timestamp = options.timestamp || new Date().toISOString();
        
        await auditLogger.audit({
            auditEntry: {
                timestamp,
                entityName: options.entityName || 'unknown',
                eventType: options.eventType,
                severity,
                success: options.success,
                actor,
                data: options.data,
                entity: options.entity,
                identifiers: options.identifiers
            }
        });
    } catch (error) {
        // Don't throw - audit failures shouldn't break business logic
        logger.error('Failed to audit:', error);
    }
}
