import { ObservabilityManager } from './manager';
import { Span } from './span';

/**
 * Observability hooks for entity CRUD operations
 * These can be called from crud-service.ts to emit observability events
 */

export interface CrudObservabilityContext {
  traceId?: string;
  parentLogId?: string;
  actor?: any;
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
    void ObservabilityManager.capture({
      type: 'audit',
      subType: 'entity.read',
      level: 'debug',
      correlationId: context?.traceId || '',
      parentLogId: context?.parentLogId,
      timestampMs: Date.now(),
      operation: `${entityName}.get`,
      entityName,
      entityId,
      actor: context?.actor,
    });
  }

  /**
   * Emit observability event for entity create operation
   */
  static captureEntityCreate(
    entityName: string,
    entityId: string,
    data: any,
    context?: CrudObservabilityContext,
  ): void {
    void ObservabilityManager.capture({
      type: 'audit',
      subType: 'entity.create',
      level: 'info',
      correlationId: context?.traceId || '',
      parentLogId: context?.parentLogId,
      timestampMs: Date.now(),
      operation: `${entityName}.create`,
      entityName,
      entityId,
      data: {
        created: true,
        ...data,
      },
      actor: context?.actor,
    });
  }

  /**
   * Emit observability event for entity update operation
   */
  static captureEntityUpdate(
    entityName: string,
    entityId: string,
    changes: any,
    context?: CrudObservabilityContext,
  ): void {
    void ObservabilityManager.capture({
      type: 'audit',
      subType: 'entity.update',
      level: 'info',
      correlationId: context?.traceId || '',
      parentLogId: context?.parentLogId,
      timestampMs: Date.now(),
      operation: `${entityName}.update`,
      entityName,
      entityId,
      data: {
        updated: true,
        changes,
      },
      actor: context?.actor,
    });
  }

  /**
   * Emit observability event for entity delete operation
   */
  static captureEntityDelete(
    entityName: string,
    entityId: string,
    context?: CrudObservabilityContext,
  ): void {
    void ObservabilityManager.capture({
      type: 'audit',
      subType: 'entity.delete',
      level: 'warn',
      correlationId: context?.traceId || '',
      parentLogId: context?.parentLogId,
      timestampMs: Date.now(),
      operation: `${entityName}.delete`,
      entityName,
      entityId,
      data: {
        deleted: true,
      },
      actor: context?.actor,
    });
  }

  /**
   * Emit observability event for entity query operation
   */
  static captureEntityQuery(
    entityName: string,
    filters: any,
    resultCount: number,
    context?: CrudObservabilityContext,
  ): void {
    void ObservabilityManager.capture({
      type: 'audit',
      subType: 'entity.query',
      level: 'debug',
      correlationId: context?.traceId || '',
      parentLogId: context?.parentLogId,
      timestampMs: Date.now(),
      operation: `${entityName}.query`,
      entityName,
      data: {
        filters,
        resultCount,
      },
      actor: context?.actor,
    });
  }

  /**
   * Create a span for entity operation (for more detailed tracing)
   */
  static createEntitySpan(
    operation: string,
    entityName: string,
    context?: CrudObservabilityContext,
  ): Span {
    return new Span(`${entityName}.${operation}`, {
      traceId: context?.traceId,
      parentSpanId: context?.parentLogId, // parentLogId maps to parentSpanId in Span constructor
      level: 'debug',
      attributes: {
        'entity.name': entityName,
        'entity.operation': operation,
      },
    });
  }
}


