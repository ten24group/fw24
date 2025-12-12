"use strict";
/**
 * Observability hooks for entity CRUD operations
 *
 * These can be called from crud-service.ts to emit observability events.
 * Uses AuditObserver for entity audits and SpanObserver for detailed tracing.
 *
 * NOTE: Methods will auto-generate correlationId if not in context,
 * logging a warning to encourage proper context establishment.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CrudObservabilityHooks = void 0;
const audit_1 = require("./observers/audit");
const span_1 = require("./observers/span");
const logging_1 = require("../logging");
const logger = (0, logging_1.createLogger)('CrudObservabilityHooks');
class CrudObservabilityHooks {
    /**
     * Emit observability event for entity read operation
     */
    static captureEntityRead(entityName, entityId, context) {
        audit_1.AuditObserver.entityRead(entityName, entityId, {
            correlationId: context?.correlationId,
            actor: context?.actor,
        });
    }
    /**
     * Emit observability event for entity create operation
     */
    static captureEntityCreate(entityName, entityId, data, context) {
        audit_1.AuditObserver.entityCreate(entityName, entityId, data, {
            correlationId: context?.correlationId,
            actor: context?.actor,
        });
    }
    /**
     * Emit observability event for entity update operation
     */
    static captureEntityUpdate(entityName, entityId, changes, context) {
        audit_1.AuditObserver.entityUpdate(entityName, entityId, changes, {
            correlationId: context?.correlationId,
            actor: context?.actor,
        });
    }
    /**
     * Emit observability event for entity delete operation
     */
    static captureEntityDelete(entityName, entityId, deletedData, context) {
        audit_1.AuditObserver.entityDelete(entityName, entityId, deletedData, {
            correlationId: context?.correlationId,
            actor: context?.actor,
        });
    }
    /**
     * Emit observability event for entity query operation
     */
    static captureEntityQuery(entityName, filters, resultCount, context) {
        audit_1.AuditObserver.entityList(entityName, filters, resultCount, {
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
    static createEntitySpan(operation, entityName, context) {
        return span_1.SpanObserver.start(`${entityName}.${operation}`, {
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
    static captureEntityBulkCreate(entityName, entityIds, count, context) {
        audit_1.AuditObserver.record({
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
    static captureEntityBulkUpdate(entityName, entityIds, count, context) {
        audit_1.AuditObserver.record({
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
    static captureEntityBulkDelete(entityName, entityIds, count, context) {
        audit_1.AuditObserver.record({
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
exports.CrudObservabilityHooks = CrudObservabilityHooks;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3J1ZC1ob29rcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2NydWQtaG9va3MudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7OztHQVFHOzs7QUFHSCw2Q0FBa0Q7QUFDbEQsMkNBQStEO0FBQy9ELHdDQUEwQztBQUUxQyxNQUFNLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsd0JBQXdCLENBQUMsQ0FBQztBQVF0RCxNQUFhLHNCQUFzQjtJQUNqQzs7T0FFRztJQUNILE1BQU0sQ0FBQyxpQkFBaUIsQ0FDdEIsVUFBa0IsRUFDbEIsUUFBZ0IsRUFDaEIsT0FBa0M7UUFFbEMscUJBQWEsQ0FBQyxVQUFVLENBQUMsVUFBVSxFQUFFLFFBQVEsRUFBRTtZQUM3QyxhQUFhLEVBQUUsT0FBTyxFQUFFLGFBQWE7WUFDckMsS0FBSyxFQUFFLE9BQU8sRUFBRSxLQUFLO1NBQ3RCLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRDs7T0FFRztJQUNILE1BQU0sQ0FBQyxtQkFBbUIsQ0FDeEIsVUFBa0IsRUFDbEIsUUFBZ0IsRUFDaEIsSUFBYSxFQUNiLE9BQWtDO1FBRWxDLHFCQUFhLENBQUMsWUFBWSxDQUFDLFVBQVUsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFO1lBQ3JELGFBQWEsRUFBRSxPQUFPLEVBQUUsYUFBYTtZQUNyQyxLQUFLLEVBQUUsT0FBTyxFQUFFLEtBQUs7U0FDdEIsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVEOztPQUVHO0lBQ0gsTUFBTSxDQUFDLG1CQUFtQixDQUN4QixVQUFrQixFQUNsQixRQUFnQixFQUNoQixPQUE4RCxFQUM5RCxPQUFrQztRQUVsQyxxQkFBYSxDQUFDLFlBQVksQ0FBQyxVQUFVLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBRTtZQUN4RCxhQUFhLEVBQUUsT0FBTyxFQUFFLGFBQWE7WUFDckMsS0FBSyxFQUFFLE9BQU8sRUFBRSxLQUFLO1NBQ3RCLENBQUMs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YnNlcnZhYmlsaXR5IGhvb2tzIGZvciBlbnRpdHkgQ1JVRCBvcGVyYXRpb25zXG4gKiBcbiAqIFRoZXNlIGNhbiBiZSBjYWxsZWQgZnJvbSBjcnVkLXNlcnZpY2UudHMgdG8gZW1pdCBvYnNlcnZhYmlsaXR5IGV2ZW50cy5cbiAqIFVzZXMgQXVkaXRPYnNlcnZlciBmb3IgZW50aXR5IGF1ZGl0cyBhbmQgU3Bhbk9ic2VydmVyIGZvciBkZXRhaWxlZCB0cmFjaW5nLlxuICogXG4gKiBOT1RFOiBNZXRob2RzIHdpbGwgYXV0by1nZW5lcmF0ZSBjb3JyZWxhdGlvbklkIGlmIG5vdCBpbiBjb250ZXh0LFxuICogbG9nZ2luZyBhIHdhcm5pbmcgdG8gZW5jb3VyYWdlIHByb3BlciBjb250ZXh0IGVzdGFibGlzaG1lbnQuXG4gKi9cblxuaW1wb3J0IHsgQWN0b3IgfSBmcm9tICcuLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IEF1ZGl0T2JzZXJ2ZXIgfSBmcm9tICcuL29ic2VydmVycy9hdWRpdCc7XG5pbXBvcnQgeyBTcGFuT2JzZXJ2ZXIsIElTcGFuT2JzZXJ2ZXIgfSBmcm9tICcuL29ic2VydmVycy9zcGFuJztcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4uL2xvZ2dpbmcnO1xuXG5jb25zdCBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ0NydWRPYnNlcnZhYmlsaXR5SG9va3MnKTtcblxuZXhwb3J0IGludGVyZmFjZSBDcnVkT2JzZXJ2YWJpbGl0eUNvbnRleHQge1xuICBjb3JyZWxhdGlvbklkPzogc3RyaW5nO1xuICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ/OiBzdHJpbmc7XG4gIGFjdG9yPzogQWN0b3I7XG59XG5cbmV4cG9ydCBjbGFzcyBDcnVkT2JzZXJ2YWJpbGl0eUhvb2tzIHtcbiAgLyoqXG4gICAqIEVtaXQgb2JzZXJ2YWJpbGl0eSBldmVudCBmb3IgZW50aXR5IHJlYWQgb3BlcmF0aW9uXG4gICAqL1xuICBzdGF0aWMgY2FwdHVyZUVudGl0eVJlYWQoXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIGVudGl0eUlkOiBzdHJpbmcsXG4gICAgY29udGV4dD86IENydWRPYnNlcnZhYmlsaXR5Q29udGV4dCxcbiAgKTogdm9pZCB7XG4gICAgQXVkaXRPYnNlcnZlci5lbnRpdHlSZWFkKGVudGl0eU5hbWUsIGVudGl0eUlkLCB7XG4gICAgICBjb3JyZWxhdGlvbklkOiBjb250ZXh0Py5jb3JyZWxhdGlvbklkLFxuICAgICAgYWN0b3I6IGNvbnRleHQ/LmFjdG9yLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEVtaXQgb2JzZXJ2YWJpbGl0eSBldmVudCBmb3IgZW50aXR5IGNyZWF0ZSBvcGVyYXRpb25cbiAgICovXG4gIHN0YXRpYyBjYXB0dXJlRW50aXR5Q3JlYXRlKFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBlbnRpdHlJZDogc3RyaW5nLFxuICAgIGRhdGE6IHVua25vd24sXG4gICAgY29udGV4dD86IENydWRPYnNlcnZhYmlsaXR5Q29udGV4dCxcbiAgKTogdm9pZCB7XG4gICAgQXVkaXRPYnNlcnZlci5lbnRpdHlDcmVhdGUoZW50aXR5TmFtZSwgZW50aXR5SWQsIGRhdGEsIHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IGNvbnRleHQ/LmNvcnJlbGF0aW9uSWQsXG4gICAgICBhY3RvcjogY29udGV4dD8uYWN0b3IsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogRW1pdCBvYnNlcnZhYmlsaXR5IGV2ZW50IGZvciBlbnRpdHkgdXBkYXRlIG9wZXJhdGlvblxuICAgKi9cbiAgc3RhdGljIGNhcHR1cmVFbnRpdHlVcGRhdGUoXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIGVudGl0eUlkOiBzdHJpbmcsXG4gICAgY2hhbmdlczogeyBiZWZvcmU/OiB1bmtub3duOyBhZnRlcj86IHVua25vd247IGRpZmY/OiB1bmtub3duIH0sXG4gICAgY29udGV4dD86IENydWRPYnNlcnZhYmlsaXR5Q29udGV4dCxcbiAgKTogdm9pZCB7XG4gICAgQXVkaXRPYnNlcnZlci5lbnRpdHlVcGRhdGUoZW50aXR5TmFtZSwgZW50aXR5SWQsIGNoYW5nZXMsIHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IGNvbnRleHQ/LmNvcnJlbGF0aW9uSWQsXG4gICAgICBhY3RvcjogY29udGV4dD8uYWN0b3IsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogRW1pdCBvYnNlcnZhYmlsaXR5IGV2ZW50IGZvciBlbnRpdHkgZGVsZXRlIG9wZXJhdGlvblxuICAgKi9cbiAgc3RhdGljIGNhcHR1cmVFbnRpdHlEZWxldGUoXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIGVudGl0eUlkOiBzdHJpbmcsXG4gICAgZGVsZXRlZERhdGE/OiB1bmtub3duLFxuICAgIGNvbnRleHQ/OiBDcnVkT2JzZXJ2YWJpbGl0eUNvbnRleHQsXG4gICk6IHZvaWQge1xuICAgIEF1ZGl0T2JzZXJ2ZXIuZW50aXR5RGVsZXRlKGVudGl0eU5hbWUsIGVudGl0eUlkLCBkZWxldGVkRGF0YSwge1xuICAgICAgY29ycmVsYXRpb25JZDogY29udGV4dD8uY29ycmVsYXRpb25JZCxcbiAgICAgIGFjdG9yOiBjb250ZXh0Py5hY3RvcixcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFbWl0IG9ic2VydmFiaWxpdHkgZXZlbnQgZm9yIGVudGl0eSBxdWVyeSBvcGVyYXRpb25cbiAgICovXG4gIHN0YXRpYyBjYXB0dXJlRW50aXR5UXVlcnkoXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIGZpbHRlcnM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuICAgIHJlc3VsdENvdW50OiBudW1iZXIsXG4gICAgY29udGV4dD86IENydWRPYnNlcnZhYmlsaXR5Q29udGV4dCxcbiAgKTogdm9pZCB7XG4gICAgQXVkaXRPYnNlcnZlci5lbnRpdHlMaXN0KGVudGl0eU5hbWUsIGZpbHRlcnMsIHJlc3VsdENvdW50LCB7XG4gICAgICBjb3JyZWxhdGlvbklkOiBjb250ZXh0Py5jb3JyZWxhdGlvbklkLFxuICAgICAgYWN0b3I6IGNvbnRleHQ/LmFjdG9yLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZSBhIHNwYW4gZm9yIGVudGl0eSBvcGVyYXRpb24gKGZvciBtb3JlIGRldGFpbGVkIHRyYWNpbmcpXG4gICAqIFxuICAgKiBAcmV0dXJucyBJU3Bhbk9ic2VydmVyIGluc3RhbmNlIGZvciB0cmFja2luZyB0aGUgb3BlcmF0aW9uLlxuICAgKiAgICAgICAgICBBdXRvLWdlbmVyYXRlcyBjb3JyZWxhdGlvbklkIGlmIG5vdCBpbiBjb250ZXh0LlxuICAgKi9cbiAgc3RhdGljIGNyZWF0ZUVudGl0eVNwYW4oXG4gICAgb3BlcmF0aW9uOiBzdHJpbmcsXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIGNvbnRleHQ/OiBDcnVkT2JzZXJ2YWJpbGl0eUNvbnRleHQsXG4gICk6IElTcGFuT2JzZXJ2ZXIge1xuICAgIHJldHVybiBTcGFuT2JzZXJ2ZXIuc3RhcnQoYCR7ZW50aXR5TmFtZX0uJHtvcGVyYXRpb259YCwge1xuICAgICAgY29ycmVsYXRpb25JZDogY29udGV4dD8uY29ycmVsYXRpb25JZCxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogY29udGV4dD8ucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkLFxuICAgICAgbGV2ZWw6ICdkZWJ1ZycsXG4gICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICdlbnRpdHkubmFtZSc6IGVudGl0eU5hbWUsXG4gICAgICAgICdlbnRpdHkub3BlcmF0aW9uJzogb3BlcmF0aW9uLFxuICAgICAgfSxcbiAgICAgIGFjdG9yOiBjb250ZXh0Py5hY3RvcixcbiAgICB9KTtcbiAgfVxuXG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgLy8gQmF0Y2ggT3BlcmF0aW9uc1xuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgLyoqXG4gICAqIEVtaXQgb2JzZXJ2YWJpbGl0eSBldmVudCBmb3IgYnVsayBlbnRpdHkgY3JlYXRlIG9wZXJhdGlvblxuICAgKi9cbiAgc3RhdGljIGNhcHR1cmVFbnRpdHlCdWxrQ3JlYXRlKFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBlbnRpdHlJZHM6IHN0cmluZ1tdLFxuICAgIGNvdW50OiBudW1iZXIsXG4gICAgY29udGV4dD86IENydWRPYnNlcnZhYmlsaXR5Q29udGV4dCxcbiAgKTogdm9pZCB7XG4gICAgQXVkaXRPYnNlcnZlci5yZWNvcmQoe1xuICAgICAgb3BlcmF0aW9uOiBgJHtlbnRpdHlOYW1lfS5idWxrQ3JlYXRlYCxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBkYXRhOiB7XG4gICAgICAgIGVudGl0eUlkcyxcbiAgICAgICAgY291bnQsXG4gICAgICB9LFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IGNvbnRleHQ/LmNvcnJlbGF0aW9uSWQsXG4gICAgICBhY3RvcjogY29udGV4dD8uYWN0b3IsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogRW1pdCBvYnNlcnZhYmlsaXR5IGV2ZW50IGZvciBidWxrIGVudGl0eSB1cGRhdGUgb3BlcmF0aW9uXG4gICAqL1xuICBzdGF0aWMgY2FwdHVyZUVudGl0eUJ1bGtVcGRhdGUoXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIGVudGl0eUlkczogc3RyaW5nW10sXG4gICAgY291bnQ6IG51bWJlcixcbiAgICBjb250ZXh0PzogQ3J1ZE9ic2VydmFiaWxpdHlDb250ZXh0LFxuICApOiB2b2lkIHtcbiAgICBBdWRpdE9ic2VydmVyLnJlY29yZCh7XG4gICAgICBvcGVyYXRpb246IGAke2VudGl0eU5hbWV9LmJ1bGtVcGRhdGVgLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIGRhdGE6IHtcbiAgICAgICAgZW50aXR5SWRzLFxuICAgICAgICBjb3VudCxcbiAgICAgIH0sXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgY29ycmVsYXRpb25JZDogY29udGV4dD8uY29ycmVsYXRpb25JZCxcbiAgICAgIGFjdG9yOiBjb250ZXh0Py5hY3RvcixcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFbWl0IG9ic2VydmFiaWxpdHkgZXZlbnQgZm9yIGJ1bGsgZW50aXR5IGRlbGV0ZSBvcGVyYXRpb25cbiAgICovXG4gIHN0YXRpYyBjYXB0dXJlRW50aXR5QnVsa0RlbGV0ZShcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgZW50aXR5SWRzOiBzdHJpbmdbXSxcbiAgICBjb3VudDogbnVtYmVyLFxuICAgIGNvbnRleHQ/OiBDcnVkT2JzZXJ2YWJpbGl0eUNvbnRleHQsXG4gICk6IHZvaWQge1xuICAgIEF1ZGl0T2JzZXJ2ZXIucmVjb3JkKHtcbiAgICAgIG9wZXJhdGlvbjogYCR7ZW50aXR5TmFtZX0uYnVsa0RlbGV0ZWAsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgZGF0YToge1xuICAgICAgICBlbnRpdHlJZHMsXG4gICAgICAgIGNvdW50LFxuICAgICAgfSxcbiAgICAgIGxldmVsOiAnd2FybicsIC8vIEJ1bGsgZGVsZXRlcyBhcmUgbW9yZSBzaWduaWZpY2FudFxuICAgICAgY29ycmVsYXRpb25JZDogY29udGV4dD8uY29ycmVsYXRpb25JZCxcbiAgICAgIGFjdG9yOiBjb250ZXh0Py5hY3RvcixcbiAgICB9KTtcbiAgfVxuXG59XG4iXX0=