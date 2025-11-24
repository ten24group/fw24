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
export declare class CrudObservabilityHooks {
    /**
     * Emit observability event for entity read operation
     */
    static captureEntityRead(entityName: string, entityId: string, context?: CrudObservabilityContext): void;
    /**
     * Emit observability event for entity create operation
     */
    static captureEntityCreate(entityName: string, entityId: string, data: any, context?: CrudObservabilityContext): void;
    /**
     * Emit observability event for entity update operation
     */
    static captureEntityUpdate(entityName: string, entityId: string, changes: any, context?: CrudObservabilityContext): void;
    /**
     * Emit observability event for entity delete operation
     */
    static captureEntityDelete(entityName: string, entityId: string, context?: CrudObservabilityContext): void;
    /**
     * Emit observability event for entity query operation
     */
    static captureEntityQuery(entityName: string, filters: any, resultCount: number, context?: CrudObservabilityContext): void;
    /**
     * Create a span for entity operation (for more detailed tracing)
     */
    static createEntitySpan(operation: string, entityName: string, context?: CrudObservabilityContext): Span;
}
