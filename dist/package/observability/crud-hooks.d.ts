/**
 * Observability hooks for entity CRUD operations
 *
 * These can be called from crud-service.ts to emit observability events.
 * Uses AuditObserver for entity audits.
 */
import { SpanOptions } from './observers/span';
/**
 * Context for CRUD operations - compatible with SpanOptions and BaseObserverOptions.
 * Allows passing explicit trace context when not using AsyncLocalStorage context.
 */
export type CrudObservabilityContext = Pick<SpanOptions, 'correlationId' | 'causedBy' | 'actor'>;
export declare class CrudObservabilityHooks {
    /**
     * Emit observability event for entity read operation
     */
    static captureEntityRead(entityName: string, entityId: string, context?: CrudObservabilityContext): void;
    /**
     * Emit observability event for entity create operation
     */
    static captureEntityCreate(entityName: string, entityId: string, data: unknown, context?: CrudObservabilityContext): void;
    /**
     * Emit observability event for entity update operation
     */
    static captureEntityUpdate(entityName: string, entityId: string, changes: {
        before?: unknown;
        after?: unknown;
        diff?: unknown;
    }, context?: CrudObservabilityContext): void;
    /**
     * Emit observability event for entity delete operation
     */
    static captureEntityDelete(entityName: string, entityId: string, deletedData?: unknown, context?: CrudObservabilityContext): void;
    /**
     * Emit observability event for entity query operation
     */
    static captureEntityQuery(entityName: string, filters: Record<string, unknown>, resultCount: number, context?: CrudObservabilityContext): void;
    /**
     * Wrap an entity operation in a span.
     * Use for more detailed tracing of entity operations.
     *
     * @example
     * ```typescript
     * const result = await CrudObservabilityHooks.wrapEntityOperation(
     *   'findById',
     *   'Order',
     *   async () => this.repository.findById(id)
     * );
     * ```
     */
    static wrapEntityOperation<T>(operation: string, entityName: string, fn: () => T, context?: CrudObservabilityContext): T;
    /**
     * Emit observability event for bulk entity create operation
     */
    static captureEntityBulkCreate(entityName: string, entityIds: string[], count: number, context?: CrudObservabilityContext): void;
    /**
     * Emit observability event for bulk entity update operation
     */
    static captureEntityBulkUpdate(entityName: string, entityIds: string[], count: number, context?: CrudObservabilityContext): void;
    /**
     * Emit observability event for bulk entity delete operation
     */
    static captureEntityBulkDelete(entityName: string, entityIds: string[], count: number, context?: CrudObservabilityContext): void;
}
