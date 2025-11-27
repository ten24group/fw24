/**
 * Observability hooks for entity CRUD operations
 * 
 * These can be called from crud-service.ts to emit observability events.
 * Uses AuditObserver for entity audits and SpanObserver for detailed tracing.
 * 
 * NOTE: All methods require a correlationId in the context. Without it,
 * they will log a warning and skip the observability event.
 */

import { Actor } from '../core/types/execution-context';
import { AuditObserver } from './observers/audit';
import { SpanObserver, ISpanObserver } from './observers/span';
import { createLogger } from '../logging';

const logger = createLogger('CrudObservabilityHooks');

export interface CrudObservabilityContext {
  correlationId?: string;
  parentLogId?: string;
  actor?: Actor;
}

export class CrudObservabilityHooks {
  /**
   * Emit observability event for entity read operation
   */
  static captureEntityRead(
    entityName: string,
    entityId: string,
    context?: CrudObservabilityContext,
  ): void {
    if (!context?.correlationId) {
      logger.debug(`captureEntityRead(${entityName}): No correlationId, skipping audit`);
      return;
    }
    AuditObserver.entityRead(entityName, entityId, {
      correlationId: context.correlationId,
      actor: context.actor,
    });
  }

  /**
   * Emit observability event for entity create operation
   */
  static captureEntityCreate(
    entityName: string,
    entityId: string,
    data: unknown,
    context?: CrudObservabilityContext,
  ): void {
    if (!context?.correlationId) {
      logger.debug(`captureEntityCreate(${entityName}): No correlationId, skipping audit`);
      return;
    }
    AuditObserver.entityCreate(entityName, entityId, data, {
      correlationId: context.correlationId,
      actor: context.actor,
    });
  }

  /**
   * Emit observability event for entity update operation
   */
  static captureEntityUpdate(
    entityName: string,
    entityId: string,
    changes: { before?: unknown; after?: unknown; diff?: unknown },
    context?: CrudObservabilityContext,
  ): void {
    if (!context?.correlationId) {
      logger.debug(`captureEntityUpdate(${entityName}): No correlationId, skipping audit`);
      return;
    }
    AuditObserver.entityUpdate(entityName, entityId, changes, {
      correlationId: context.correlationId,
      actor: context.actor,
    });
  }

  /**
   * Emit observability event for entity delete operation
   */
  static captureEntityDelete(
    entityName: string,
    entityId: string,
    deletedData?: unknown,
    context?: CrudObservabilityContext,
  ): void {
    if (!context?.correlationId) {
      logger.debug(`captureEntityDelete(${entityName}): No correlationId, skipping audit`);
      return;
    }
    AuditObserver.entityDelete(entityName, entityId, deletedData, {
      correlationId: context.correlationId,
      actor: context.actor,
    });
  }

  /**
   * Emit observability event for entity query operation
   */
  static captureEntityQuery(
    entityName: string,
    filters: Record<string, unknown>,
    resultCount: number,
    context?: CrudObservabilityContext,
  ): void {
    if (!context?.correlationId) {
      logger.debug(`captureEntityQuery(${entityName}): No correlationId, skipping audit`);
      return;
    }
    AuditObserver.entityList(entityName, filters, resultCount, {
      correlationId: context.correlationId,
      actor: context.actor,
    });
  }

  /**
   * Create a span for entity operation (for more detailed tracing)
   * 
   * @returns ISpanObserver instance for tracking the operation.
   *          Returns NoOp span if no correlationId (will log debug warning).
   */
  static createEntitySpan(
    operation: string,
    entityName: string,
    context?: CrudObservabilityContext,
  ): ISpanObserver {
    if (!context?.correlationId) {
      logger.debug(`createEntitySpan(${entityName}.${operation}): No correlationId, returning NoOp span`);
    }
    return SpanObserver.start(`${entityName}.${operation}`, {
      correlationId: context?.correlationId,
      // Note: parentSpanId maps to parentLogId in the context
      parentSpanId: context?.parentLogId,
      level: 'debug',
      attributes: {
        'entity.name': entityName,
        'entity.operation': operation,
      },
      actor: context?.actor,
    });
  }

  // ============================================================================
  // Batch Operations
  // ============================================================================

  /**
   * Emit observability event for bulk entity create operation
   */
  static captureEntityBulkCreate(
    entityName: string,
    entityIds: string[],
    count: number,
    context?: CrudObservabilityContext,
  ): void {
    if (!context?.correlationId) {
      logger.debug(`captureEntityBulkCreate(${entityName}): No correlationId, skipping audit`);
      return;
    }
    AuditObserver.record({
      operation: `${entityName}.bulkCreate`,
      entityName,
      data: {
        entityIds,
        count,
      },
      level: 'info',
      correlationId: context.correlationId,
      actor: context.actor,
    });
  }

  /**
   * Emit observability event for bulk entity update operation
   */
  static captureEntityBulkUpdate(
    entityName: string,
    entityIds: string[],
    count: number,
    context?: CrudObservabilityContext,
  ): void {
    if (!context?.correlationId) {
      logger.debug(`captureEntityBulkUpdate(${entityName}): No correlationId, skipping audit`);
      return;
    }
    AuditObserver.record({
      operation: `${entityName}.bulkUpdate`,
      entityName,
      data: {
        entityIds,
        count,
      },
      level: 'info',
      correlationId: context.correlationId,
      actor: context.actor,
    });
  }

  /**
   * Emit observability event for bulk entity delete operation
   */
  static captureEntityBulkDelete(
    entityName: string,
    entityIds: string[],
    count: number,
    context?: CrudObservabilityContext,
  ): void {
    if (!context?.correlationId) {
      logger.debug(`captureEntityBulkDelete(${entityName}): No correlationId, skipping audit`);
      return;
    }
    AuditObserver.record({
      operation: `${entityName}.bulkDelete`,
      entityName,
      data: {
        entityIds,
        count,
      },
      level: 'warn', // Bulk deletes are more significant
      correlationId: context.correlationId,
      actor: context.actor,
    });
  }

  // ============================================================================
  // Aliases
  // ============================================================================

  /**
   * Alias for captureEntityQuery for consistent naming
   */
  static captureEntityList(
    entityName: string,
    filters: Record<string, unknown>,
    resultCount: number,
    context?: CrudObservabilityContext,
  ): void {
    return this.captureEntityQuery(entityName, filters, resultCount, context);
  }
}
