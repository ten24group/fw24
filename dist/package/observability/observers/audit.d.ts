/**
 * AuditObserver - Entity and action auditing
 *
 * Usage:
 * ```typescript
 * // Entity operations (context is auto-established in controllers)
 * AuditObserver.entityCreate('User', userId, userData);
 * AuditObserver.entityUpdate('User', userId, { before, after });
 * AuditObserver.entityDelete('User', userId);
 *
 * // Custom audits
 * AuditObserver.record({
 *   operation: 'permission.granted',
 *   entityName: 'User',
 *   entityId: userId,
 *   data: { role: 'admin' },
 * });
 * ```
 */
import type { ObservabilityLevelString, RecordOverrides } from '../types';
/**
 * Options for entity audit operations.
 * Extends RecordOverrides for all context override capabilities.
 */
export interface EntityAuditOptions extends RecordOverrides {
    /** Override severity level. Default varies by operation. */
    level?: ObservabilityLevelString;
    /** Additional attributes */
    attributes?: Record<string, unknown>;
}
/**
 * Options for custom audit records.
 */
export interface AuditRecordOptions extends RecordOverrides {
    /** Operation name (required) */
    operation: string;
    /** Entity name */
    entityName?: string;
    /** Entity ID */
    entityId?: string;
    /** Audit subtype for categorization */
    subType?: string;
    /** Severity level */
    level?: ObservabilityLevelString;
    /** Audit data */
    data?: Record<string, unknown>;
    /** Additional attributes */
    attributes?: Record<string, unknown>;
    /** Metrics */
    metrics?: Record<string, number>;
}
/**
 * Options for compliance audits.
 */
export interface ComplianceAuditOptions extends RecordOverrides {
    /** Operation name (required) */
    operation: string;
    /** Compliance subtype (required) */
    subType: 'pii_access' | 'data_export' | 'consent_change' | 'data_deletion' | string;
    /** Entity name */
    entityName?: string;
    /** Entity ID */
    entityId?: string;
    /** Audit data */
    data?: Record<string, unknown>;
    /** Additional attributes */
    attributes?: Record<string, unknown>;
    /** Metrics */
    metrics?: Record<string, number>;
}
/**
 * Options for access audits.
 */
export interface AccessAuditOptions extends RecordOverrides {
    /** Operation name (required) */
    operation: string;
    /** Resource being accessed */
    resource: string;
    /** Resource ID */
    resourceId?: string;
    /** Access action */
    action: 'view' | 'download' | 'modify' | 'share' | string;
    /** Whether access was allowed */
    allowed: boolean;
    /** Audit data */
    data?: Record<string, unknown>;
    /** Additional attributes */
    attributes?: Record<string, unknown>;
    /** Metrics */
    metrics?: Record<string, number>;
}
export declare class AuditObserver {
    /**
     * Audit entity creation
     */
    static entityCreate(entityName: string, entityId: string, data: unknown, options?: EntityAuditOptions): string | undefined;
    /**
     * Audit entity update
     */
    static entityUpdate(entityName: string, entityId: string, changes: {
        before?: unknown;
        after?: unknown;
        diff?: unknown;
    }, options?: EntityAuditOptions): string | undefined;
    /**
     * Audit entity deletion (sync)
     */
    static entityDelete(entityName: string, entityId: string, deletedData?: unknown, options?: EntityAuditOptions): string | undefined;
    /**
     * Audit entity deletion (async - waits for backend)
     */
    static entityDeleteAsync(entityName: string, entityId: string, deletedData?: unknown, options?: EntityAuditOptions): Promise<string | undefined>;
    /**
     * Audit entity read
     */
    static entityRead(entityName: string, entityId: string, options?: EntityAuditOptions): string | undefined;
    /**
     * Audit entity list operation
     */
    static entityList(entityName: string, query: Record<string, unknown>, resultCount: number, options?: EntityAuditOptions): string | undefined;
    /**
     * Record a custom audit event
     */
    static record(options: AuditRecordOptions): string | undefined;
    /**
     * Record a compliance audit (GDPR, HIPAA, etc.)
     */
    static compliance(options: ComplianceAuditOptions): string | undefined;
    /**
     * Record a compliance audit (async - waits for backend)
     */
    static complianceAsync(options: ComplianceAuditOptions): Promise<string | undefined>;
    /**
     * Record an access audit
     */
    static access(options: AccessAuditOptions): string | undefined;
}
