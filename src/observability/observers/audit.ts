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
import {
  buildCommonFields,
  captureEvent,
  captureEventAsync,
  extractObserverOptions,
  BaseObserverOptions,
  ObservabilityPayload,
} from './base';

const OBSERVER_NAME = 'AuditObserver';

export interface AuditObserverOptions extends BaseObserverOptions {
  // Inherits: correlationId, causedBy, relatedTraces, actor, source, tags, metadata
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

export class AuditObserver {

  /**
   * Record entity creation
   */
  static entityCreate(
    entityName: string,
    entityId: string,
    data: unknown,
    ctx?: ExecutionContext | AuditObserverOptions
  ): string | undefined {
    const options = extractObserverOptions(ctx);
    const fields = buildCommonFields(OBSERVER_NAME, options);

    return captureEvent(fields, {
      type: 'audit.entity',
      subType: 'create',
      level: 'info',
      operation: `${entityName}.create`,
      entityName,
      entityId,
      data: { created: data },
      tags: { ...fields.tags, audit: 'true', entityOperation: 'create' },
    });
  }

  /**
   * Record entity update
   */
  static entityUpdate(
    entityName: string,
    entityId: string,
    changes: { before?: unknown; after?: unknown; diff?: unknown },
    ctx?: ExecutionContext | AuditObserverOptions
  ): string | undefined {
    const options = extractObserverOptions(ctx);
    const fields = buildCommonFields(OBSERVER_NAME, options);

    return captureEvent(fields, {
      type: 'audit.entity',
      subType: 'update',
      level: 'info',
      operation: `${entityName}.update`,
      entityName,
      entityId,
      data: changes,
      tags: { ...fields.tags, audit: 'true', entityOperation: 'update' },
    });
  }

  /**
   * Record entity deletion
   * 
   * Note: deletedData comes before ctx for consistency with entityCreate/entityUpdate
   */
  static entityDelete(
    entityName: string,
    entityId: string,
    deletedData?: unknown,
    ctx?: ExecutionContext | AuditObserverOptions
  ): string | undefined {
    const options = extractObserverOptions(ctx);
    const fields = buildCommonFields(OBSERVER_NAME, options);

    // Deletions are critical - must not be sampled out
    return captureEvent(fields, {
      type: 'audit.entity',
      subType: 'delete',
      level: 'warn', // Deletions are notable
      operation: `${entityName}.delete`,
      entityName,
      entityId,
      data: deletedData ? { deleted: deletedData } : undefined,
      tags: { ...fields.tags, audit: 'true', entityOperation: 'delete' },
    }, { critical: true });
  }

  /**
   * Record entity deletion (async version - waits for backend completion)
   * 
   * Use when you need to ensure the audit is persisted before continuing.
   */
  static async entityDeleteAsync(
    entityName: string,
    entityId: string,
    deletedData?: unknown,
    ctx?: ExecutionContext | AuditObserverOptions
  ): Promise<string | undefined> {
    const options = extractObserverOptions(ctx);
    const fields = buildCommonFields(OBSERVER_NAME, options);

    return captureEventAsync(fields, {
      type: 'audit.entity',
      subType: 'delete',
      level: 'warn',
      operation: `${entityName}.delete`,
      entityName,
      entityId,
      data: deletedData ? { deleted: deletedData } : undefined,
      tags: { ...fields.tags, audit: 'true', entityOperation: 'delete' },
    }, { critical: true });
  }

  /**
   * Record entity read (high volume - use sparingly)
   */
  static entityRead(
    entityName: string,
    entityId: string,
    ctx?: ExecutionContext | AuditObserverOptions
  ): string | undefined {
    const options = extractObserverOptions(ctx);
    const fields = buildCommonFields(OBSERVER_NAME, options);

    return captureEvent(fields, {
      type: 'audit.entity',
      subType: 'read',
      level: 'debug', // Lower level - high volume, can be sampled
      operation: `${entityName}.read`,
      entityName,
      entityId,
      tags: { ...fields.tags, audit: 'true', entityOperation: 'read' },
    });
  }

  /**
   * Record entity list/query (high volume - use sparingly)
   */
  static entityList(
    entityName: string,
    query: Record<string, unknown>,
    resultCount: number,
    ctx?: ExecutionContext | AuditObserverOptions
  ): string | undefined {
    const options = extractObserverOptions(ctx);
    const fields = buildCommonFields(OBSERVER_NAME, options);

    return captureEvent(fields, {
      type: 'audit.entity',
      subType: 'list',
      level: 'debug',
      operation: `${entityName}.list`,
      entityName,
      data: { query, resultCount },
      tags: { ...fields.tags, audit: 'true', entityOperation: 'list' },
      metrics: { resultCount },
    });
  }

  /**
   * Record custom audit event
   */
  static record(options: AuditRecordOptions): string | undefined {
    // Pass entire options - buildCommonFields extracts only the fields it needs
    const fields = buildCommonFields(OBSERVER_NAME, options);

    return captureEvent(fields, {
      type: 'audit',
      subType: options.subType,
      level: options.level ?? 'info',
      operation: options.operation,
      entityName: options.entityName,
      entityId: options.entityId,
      data: options.data,
      metrics: options.metrics,
      attributes: options.attributes,
      tags: { ...fields.tags, audit: 'true' },
    });
  }

  /**
   * Record compliance audit (PII access, data export, etc.)
   * 
   * @param options.metadata - Flexible metadata for compliance info (reason, justification, etc.)
   */
  static compliance(options: ComplianceAuditOptions): string | undefined {
    const fields = buildCommonFields(OBSERVER_NAME, options);

    // Compliance events are critical - must not be sampled out
    return captureEvent(fields, {
      type: 'audit.compliance',
      subType: options.subType,
      level: 'info',
      operation: options.operation,
      entityName: options.entityName,
      entityId: options.entityId,
      data: options.data,
      metrics: options.metrics,
      attributes: options.attributes,
      tags: { ...fields.tags, audit: 'true', compliance: 'true' },
    }, { critical: true });
  }

  /**
   * Record compliance audit (async version - waits for backend completion)
   * 
   * Use when you need to ensure the audit is persisted before continuing.
   * 
   * @param options.metadata - Flexible metadata for compliance info (reason, justification, etc.)
   */
  static async complianceAsync(options: ComplianceAuditOptions): Promise<string | undefined> {
    const fields = buildCommonFields(OBSERVER_NAME, options);

    return captureEventAsync(fields, {
      type: 'audit.compliance',
      subType: options.subType,
      level: 'info',
      operation: options.operation,
      entityName: options.entityName,
      entityId: options.entityId,
      data: options.data,
      metrics: options.metrics,
      attributes: options.attributes,
      tags: { ...fields.tags, audit: 'true', compliance: 'true' },
    }, { critical: true });
  }

  /**
   * Record access audit (for sensitive resources)
   */
  static access(options: AccessAuditOptions): string | undefined {
    const fields = buildCommonFields(OBSERVER_NAME, options);

    return captureEvent(fields, {
      type: 'audit.access',
      subType: options.action,
      level: options.allowed ? 'info' : 'warn',
      operation: options.operation,
      entityName: options.resource,
      entityId: options.resourceId,
      success: options.allowed,
      data: options.data,
      metrics: options.metrics,
      attributes: options.attributes,
      tags: { ...fields.tags, audit: 'true', access: 'true' },
    });
  }
}
