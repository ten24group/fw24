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
import { captureRecord, captureRecordAsync } from './base';

const OBSERVER_NAME = 'AuditObserver';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// AuditObserver
// ═══════════════════════════════════════════════════════════════════════════

export class AuditObserver {

  // ─────────────────────────────────────────────────────────────────────────
  // Entity Lifecycle Audits
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Audit entity creation
   */
  static entityCreate(
    entityName: string,
    entityId: string,
    data: unknown,
    options?: EntityAuditOptions
  ): string | undefined {
    const { level, attributes, ...overrides } = options ?? {};

    return captureRecord(OBSERVER_NAME, {
      type: 'audit.entity',
      subType: 'create',
      level: level ?? 'info',
      operation: `${entityName}.create`,
      entityName,
      entityId,
      data: { created: data } as Record<string, unknown>,
      attributes,
      tags: { audit: 'true', entityOperation: 'create' },
      ...overrides,
    });
  }

  /**
   * Audit entity update
   */
  static entityUpdate(
    entityName: string,
    entityId: string,
    changes: { before?: unknown; after?: unknown; diff?: unknown },
    options?: EntityAuditOptions
  ): string | undefined {
    const { level, attributes, ...overrides } = options ?? {};

    return captureRecord(OBSERVER_NAME, {
      type: 'audit.entity',
      subType: 'update',
      level: level ?? 'info',
      operation: `${entityName}.update`,
      entityName,
      entityId,
      data: changes as Record<string, unknown>,
      attributes,
      tags: { audit: 'true', entityOperation: 'update' },
      ...overrides,
    });
  }

  /**
   * Audit entity deletion (sync)
   */
  static entityDelete(
    entityName: string,
    entityId: string,
    deletedData?: unknown,
    options?: EntityAuditOptions
  ): string | undefined {
    const { level, attributes, ...overrides } = options ?? {};

    return captureRecord(OBSERVER_NAME, {
      type: 'audit.entity',
      subType: 'delete',
      level: level ?? 'warn',
      operation: `${entityName}.delete`,
      entityName,
      entityId,
      data: deletedData ? { deleted: deletedData } as Record<string, unknown> : undefined,
      attributes,
      tags: { audit: 'true', entityOperation: 'delete' },
      ...overrides,
    });
  }

  /**
   * Audit entity deletion (async - waits for backend)
   */
  static async entityDeleteAsync(
    entityName: string,
    entityId: string,
    deletedData?: unknown,
    options?: EntityAuditOptions
  ): Promise<string | undefined> {
    const { level, attributes, ...overrides } = options ?? {};

    return captureRecordAsync(OBSERVER_NAME, {
      type: 'audit.entity',
      subType: 'delete',
      level: level ?? 'warn',
      operation: `${entityName}.delete`,
      entityName,
      entityId,
      data: deletedData ? { deleted: deletedData } as Record<string, unknown> : undefined,
      attributes,
      tags: { audit: 'true', entityOperation: 'delete' },
      ...overrides,
    });
  }

  /**
   * Audit entity read
   */
  static entityRead(
    entityName: string,
    entityId: string,
    options?: EntityAuditOptions
  ): string | undefined {
    const { level, attributes, ...overrides } = options ?? {};

    return captureRecord(OBSERVER_NAME, {
      type: 'audit.entity',
      subType: 'read',
      level: level ?? 'debug',
      operation: `${entityName}.read`,
      entityName,
      entityId,
      attributes,
      tags: { audit: 'true', entityOperation: 'read' },
      ...overrides,
    });
  }

  /**
   * Audit entity list operation
   */
  static entityList(
    entityName: string,
    query: Record<string, unknown>,
    resultCount: number,
    options?: EntityAuditOptions
  ): string | undefined {
    const { level, attributes, ...overrides } = options ?? {};

    return captureRecord(OBSERVER_NAME, {
      type: 'audit.entity',
      subType: 'list',
      level: level ?? 'debug',
      operation: `${entityName}.list`,
      entityName,
      data: { query, resultCount },
      attributes,
      tags: { audit: 'true', entityOperation: 'list' },
      ...overrides,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Custom Audits
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Record a custom audit event
   */
  static record(options: AuditRecordOptions): string | undefined {
    const {
      operation,
      entityName,
      entityId,
      subType,
      level,
      data,
      attributes,
      metrics,
      ...overrides
    } = options;

    return captureRecord(OBSERVER_NAME, {
      type: 'audit',
      subType,
      level: level ?? 'info',
      operation,
      entityName,
      entityId,
      data,
      attributes,
      metrics,
      tags: { audit: 'true' },
      ...overrides,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Specialized Audits
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Record a compliance audit (GDPR, HIPAA, etc.)
   */
  static compliance(options: ComplianceAuditOptions): string | undefined {
    const {
      operation,
      subType,
      entityName,
      entityId,
      data,
      attributes,
      metrics,
      ...overrides
    } = options;

    return captureRecord(OBSERVER_NAME, {
      type: 'audit.compliance',
      subType,
      level: 'info',
      operation,
      entityName,
      entityId,
      data,
      attributes,
      metrics,
      tags: { audit: 'true', compliance: 'true' },
      ...overrides,
    });
  }

  /**
   * Record a compliance audit (async - waits for backend)
   */
  static async complianceAsync(options: ComplianceAuditOptions): Promise<string | undefined> {
    const {
      operation,
      subType,
      entityName,
      entityId,
      data,
      attributes,
      metrics,
      ...overrides
    } = options;

    return captureRecordAsync(OBSERVER_NAME, {
      type: 'audit.compliance',
      subType,
      level: 'info',
      operation,
      entityName,
      entityId,
      data,
      attributes,
      metrics,
      tags: { audit: 'true', compliance: 'true' },
      ...overrides,
    });
  }

  /**
   * Record an access audit
   */
  static access(options: AccessAuditOptions): string | undefined {
    const {
      operation,
      resource,
      resourceId,
      action,
      allowed,
      data,
      attributes,
      metrics,
      ...overrides
    } = options;

    return captureRecord(OBSERVER_NAME, {
      type: 'audit.access',
      subType: action,
      level: allowed ? 'info' : 'warn',
      operation,
      entityName: resource,
      entityId: resourceId,
      success: allowed,
      data,
      attributes,
      metrics,
      tags: { audit: 'true', access: 'true' },
      ...overrides,
    });
  }
}
