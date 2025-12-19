/**
 * Observability hooks for entity CRUD operations
 * 
 * These can be called from crud-service.ts to emit observability events.
 * Uses AuditObserver for entity audits and SpanObserver for detailed tracing.
 * 
 * NOTE: Methods will auto-generate correlationId if not in context,
 * logging a warning to encourage proper context establishment.
 */

import { AuditObserver } from './observers/audit';
import { SpanObserver, ISpanObserver, SpanOptions } from './observers/span';

/**
 * Context for CRUD operations - compatible with SpanOptions and BaseObserverOptions.
 * Allows passing explicit trace context when not using AsyncLocalStorage context.
 */
export type CrudObservabilityContext = Pick<SpanOptions, 'correlationId' | 'parentObservabilityLogId' | 'causedBy' | 'actor'>;

export class CrudObservabilityHooks {
  /**
   * Emit observability event for entity read operation
   */
  static captureEntityRead(
    entityName: string,
    entityId: string,
    context?: CrudObservabilityContext,
  ): void {
    AuditObserver.entityRead(entityName, entityId, context);
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
    AuditObserver.entityCreate(entityName, entityId, data, context);
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
    AuditObserver.entityUpdate(entityName, entityId, changes, context);
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
    AuditObserver.entityDelete(entityName, entityId, deletedData, context);
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
    AuditObserver.entityList(entityName, filters, resultCount, context);
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
      ...context,
      level: 'debug',
      attributes: {
        'entity.name': entityName,
        'entity.operation': operation,
      },
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
      ...context,
      operation: `${entityName}.bulkCreate`,
      entityName,
      data: {
        entityIds,
        count,
      },
      level: 'info',
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
      ...context,
      operation: `${entityName}.bulkUpdate`,
      entityName,
      data: {
        entityIds,
        count,
      },
      level: 'info',
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
      ...context,
      operation: `${entityName}.bulkDelete`,
      entityName,
      data: {
        entityIds,
        count,
      },
      level: 'warn', // Bulk deletes are more significant
    });
  }

}
