/**
 * AuditObserver - For entity and action auditing
 *
 * DESIGN PRINCIPLES:
 * - Requires correlationId from context or explicit option
 * - Integrates with existing FW24 Actor type
 * - Supports entity lifecycle audits and custom audits
 * - Replaces old audit system
 *
 * Usage:
 * ```typescript
 * // FIRST: Establish context
 * await runWithContext(
 *   createObservationContext(requestId, { actor }),
 *   async () => {
 *     // Entity operations
 *     AuditObserver.entityCreate('User', userId, userData);
 *     AuditObserver.entityUpdate('User', userId, { before, after });
 *     AuditObserver.entityDelete('User', userId);
 *
 *     // Custom audits
 *     AuditObserver.record({
 *       operation: 'permission.granted',
 *       entityName: 'User',
 *       entityId: userId,
 *       data: { role: 'admin' },
 *     });
 *   }
 * );
 * ```
 */
import { ExecutionContext } from '../../core/types/execution-context';
import { ObservabilityLevelString } from '../types';
import { BaseObserverOptions, ObservabilityPayload } from './base';
export interface AuditObserverOptions extends BaseObserverOptions {
}
/**
 * Options for custom audit records
 */
export interface AuditRecordOptions extends BaseObserverOptions, ObservabilityPayload {
    operation: string;
    entityName?: string;
    entityId?: string;
    subType?: string;
    level?: ObservabilityLevelString;
}
/**
 * Options for compliance audits
 */
export interface ComplianceAuditOptions extends BaseObserverOptions, ObservabilityPayload {
    operation: string;
    /** Compliance event type */
    subType: 'pii_access' | 'data_export' | 'consent_change' | 'data_deletion' | string;
    entityName?: string;
    entityId?: string;
}
/**
 * Options for access audits
 */
export interface AccessAuditOptions extends BaseObserverOptions, ObservabilityPayload {
    operation: string;
    resource: string;
    resourceId?: string;
    action: 'view' | 'download' | 'modify' | 'share' | string;
    allowed: boolean;
}
export declare class AuditObserver {
    /**
     * Record entity creation
     */
    static entityCreate(entityName: string, entityId: string, data: unknown, ctx?: ExecutionContext | AuditObserverOptions): string | undefined;
    /**
     * Record entity update
     */
    static entityUpdate(entityName: string, entityId: string, changes: {
        before?: unknown;
        after?: unknown;
        diff?: unknown;
    }, ctx?: ExecutionContext | AuditObserverOptions): string | undefined;
    /**
     * Record entity deletion
     *
     * Note: deletedData comes before ctx for consistency with entityCreate/entityUpdate
     */
    static entityDelete(entityName: string, entityId: string, deletedData?: unknown, ctx?: ExecutionContext | AuditObserverOptions): string | undefined;
    /**
     * Record entity deletion (async version - waits for backend completion)
     *
     * Use when you need to ensure the audit is persisted before continuing.
     */
    static entityDeleteAsync(entityName: string, entityId: string, deletedData?: unknown, ctx?: ExecutionContext | AuditObserverOptions): Promise<string | undefined>;
    /**
     * Record entity read (high volume - use sparingly)
     */
    static entityRead(entityName: string, entityId: string, ctx?: ExecutionContext | AuditObserverOptions): string | undefined;
    /**
     * Record entity list/query (high volume - use sparingly)
     */
    static entityList(entityName: string, query: Record<string, unknown>, resultCount: number, ctx?: ExecutionContext | AuditObserverOptions): string | undefined;
    /**
     * Record custom audit event
     */
    static record(options: AuditRecordOptions): string | undefined;
    /**
     * Record compliance audit (PII access, data export, etc.)
     *
     * @param options.metadata - Flexible metadata for compliance info (reason, justification, etc.)
     */
    static compliance(options: ComplianceAuditOptions): string | undefined;
    /**
     * Record compliance audit (async version - waits for backend completion)
     *
     * Use when you need to ensure the audit is persisted before continuing.
     *
     * @param options.metadata - Flexible metadata for compliance info (reason, justification, etc.)
     */
    static complianceAsync(options: ComplianceAuditOptions): Promise<string | undefined>;
    /**
     * Record access audit (for sensitive resources)
     */
    static access(options: AccessAuditOptions): string | undefined;
}
