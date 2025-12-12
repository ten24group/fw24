/**
 * Observability hooks for entity CRUD operations
 * 
 * These can be called from crud-service.ts to emit observability events.
 * Uses AuditObserver for entity audits and SpanObserver for detailed tracing.
 * 
 * NOTE: Methods will auto-generate correlationId if not in context,
 * logging a warning to encourage proper context establishment.
 */

import { Actor } from '../core/types/execution-context';
import { AuditObserver } from './observers/audit';
import { SpanObserver, ISpanObserver } from './observers/span';
import { createLogger } from '../logging';

const logger = createLogger('CrudObservabilityHooks');

export interface CrudObservabilityContext {
  correlationId?: string;
  parentObservabilityLogId?: string;
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
    AuditObserver.entityRead(entityName, entityId, {
      correlationId: context?.correlationId,
      actor: context?.actor,
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
    AuditObserver.entityCreate(entityName, entityId, data, {
      correlationId: context?.correlationId,
      actor: context?.actor,
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
    AuditObserver.entityUpdate(entityName, entityId, changes, {
      correlationId: context?.correlationId,
      actor: context?.actor,
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
    AuditObserver.entityDelete(entityName, entityId, deletedData, {
      correlationId: context?.correlationId,
      actor: context?.actor,
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
    AuditObserver.entityList(entityName, filters, resultCount, {
      correlationId: context?.correlationId,
      actor: context?.actor,
    });
  }

  /**
   * Create a span for entity operation (for more detailed tracing)
   * 
   * @returns ISpanObserver instance for tracking the operation.
   *          Auto-generates correlationId if not in context.
   */
  static createEntitySpan(
    operation: string,
    entityName: string,
    context?: CrudObservabilityContext,
  ): ISpanObserver {
    return SpanObserver.start(`${entityName}.${operation}`, {
      correlationId: context?.correlationId,
      parentObservabilityLogId: context?.parentObservabilityLogId,
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
    AuditObserver.record({
      operation: `${entityName}.bulkCreate`,
      entityName,
      data: {
        entityIds,
        count,
      },
      level: 'info',
      correlationId: context?.correlationId,
      actor: context?.actor,
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
    AuditObserver.record({
      operation: `${entityName}.bulkUpdate`,
      entityName,
      data: {
        entityIds,
        count,
      },
      level: 'info',
      correlationId: context?.correlationId,
      actor: context?.actor,
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
    AuditObserver.record({
      operation: `${entityName}.bulkDelete`,
      entityName,
      data: {
        entityIds,
        count,
      },
      level: 'warn', // Bulk deletes are more significant
      correlationId: context?.correlationId,
      actor: context?.actor,
    });
  }

}
