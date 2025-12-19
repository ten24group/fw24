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
class CrudObservabilityHooks {
    /**
     * Emit observability event for entity read operation
     */
    static captureEntityRead(entityName, entityId, context) {
        audit_1.AuditObserver.entityRead(entityName, entityId, context);
    }
    /**
     * Emit observability event for entity create operation
     */
    static captureEntityCreate(entityName, entityId, data, context) {
        audit_1.AuditObserver.entityCreate(entityName, entityId, data, context);
    }
    /**
     * Emit observability event for entity update operation
     */
    static captureEntityUpdate(entityName, entityId, changes, context) {
        audit_1.AuditObserver.entityUpdate(entityName, entityId, changes, context);
    }
    /**
     * Emit observability event for entity delete operation
     */
    static captureEntityDelete(entityName, entityId, deletedData, context) {
        audit_1.AuditObserver.entityDelete(entityName, entityId, deletedData, context);
    }
    /**
     * Emit observability event for entity query operation
     */
    static captureEntityQuery(entityName, filters, resultCount, context) {
        audit_1.AuditObserver.entityList(entityName, filters, resultCount, context);
    }
    /**
     * Create a span for entity operation (for more detailed tracing)
     *
     * @returns ISpanObserver instance for tracking the operation.
     *          Auto-generates correlationId if not in context.
     */
    static createEntitySpan(operation, entityName, context) {
        return span_1.SpanObserver.start(`${entityName}.${operation}`, {
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
    static captureEntityBulkCreate(entityName, entityIds, count, context) {
        audit_1.AuditObserver.record({
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
    static captureEntityBulkUpdate(entityName, entityIds, count, context) {
        audit_1.AuditObserver.record({
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
    static captureEntityBulkDelete(entityName, entityIds, count, context) {
        audit_1.AuditObserver.record({
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
exports.CrudObservabilityHooks = CrudObservabilityHooks;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3J1ZC1ob29rcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2NydWQtaG9va3MudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7OztHQVFHOzs7QUFFSCw2Q0FBa0Q7QUFDbEQsMkNBQTRFO0FBUTVFLE1BQWEsc0JBQXNCO0lBQ2pDOztPQUVHO0lBQ0gsTUFBTSxDQUFDLGlCQUFpQixDQUN0QixVQUFrQixFQUNsQixRQUFnQixFQUNoQixPQUFrQztRQUVsQyxxQkFBYSxDQUFDLFVBQVUsQ0FBQyxVQUFVLEVBQUUsUUFBUSxFQUFFLE9BQU8sQ0FBQyxDQUFDO0lBQzFELENBQUM7SUFFRDs7T0FFRztJQUNILE1BQU0sQ0FBQyxtQkFBbUIsQ0FDeEIsVUFBa0IsRUFDbEIsUUFBZ0IsRUFDaEIsSUFBYSxFQUNiLE9BQWtDO1FBRWxDLHFCQUFhLENBQUMsWUFBWSxDQUFDLFVBQVUsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLE9BQU8sQ0FBQyxDQUFDO0lBQ2xFLENBQUM7SUFFRDs7T0FFRztJQUNILE1BQU0sQ0FBQyxtQkFBbUIsQ0FDeEIsVUFBa0IsRUFDbEIsUUFBZ0IsRUFDaEIsT0FBOEQsRUFDOUQsT0FBa0M7UUFFbEMscUJBQWEsQ0FBQyxZQUFZLENBQUMsVUFBVSxFQUFFLFFBQVEsRUFBRSxPQUFPLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFDckUsQ0FBQztJQUVEOztPQUVHO0lBQ0gsTUFBTSxDQUFDLG1CQUFtQixDQUN4QixVQUFrQixFQUNsQixRQUFnQixFQUNoQixXQUFxQixFQUNyQixPQUFrQztRQUVsQyxxQkFBYSxDQUFDLFlBQVksQ0FBQyxVQUFVLEVBQUUsUUFBUSxFQUFFLFdBQVcsRUFBRSxPQUFPLENBQUMsQ0FBQztJQUN6RSxDQUFDO0lBRUQ7O09BRUc7SUFDSCxNQUFNLENBQUMsa0JBQWtCLENBQ3ZCLFVBQWtCLEVBQ2xCLE9BQWdDLEVBQ2hDLFdBQW1CLEVBQ25CLE9BQWtDO1FBRWxDLHFCQUFhLENBQUMsVUFBVSxDQUFDLFVBQVUsRUFBRSxPQUFPLEVBQUUsV0FBVyxFQUFFLE9BQU8sQ0FBQyxDQUFDO0lBQ3RFLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILE1BQU0sQ0FBQyxnQkFBZ0IsQ0FDckIsU0FBaUIsRUFDakIsVUFBa0IsRUFDbEIsT0FBa0M7UUFFbEMsT0FBTyxtQkFBWSxDQUFDLEtBQUssQ0FBQyxHQUFHLFVBQVUsSUFBSSxTQUFTLEVBQUUsRUFBRTtZQUN0RCxHQUFHLE9BQU87WUFDVixLQUFLLEVBQUUsT0FBTztZQUNkLFVBQVUsRUFBRTtnQkFDVixhQUFhLEVBQUUsVUFBVTtnQkFDekIsa0JBQWtCLEVBQUUsU0FBUzthQUM5QjtTQUNGLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRCwrRUFBK0U7SUFDL0UsbUJBQW1CO0lBQ25CLCtFQUErRTtJQUUvRTs7T0FFRztJQUNILE1BQU0sQ0FBQyx1QkFBdUIsQ0FDNUIsVUFBa0IsRUFDbEIsU0FBbUIsRUFDbkIsS0FBYSxFQUNiLE9BQWtDO1FBRWxDLHFCQUFhLENBQUMsTUFBTSxDQUFDO1lBQ25CLEdBQUcsT0FBTztZQUNWLFNBQVMsRUFBRSxHQUFHLFVBQVUsYUFBYTtZQUNyQyxVQUFVO1lBQ1YsSUFBSSxFQUFFO2dCQUNKLFNBQVM7Z0JBQ1QsS0FBSzthQUNOO1lBQ0QsS0FBSyxFQUFFLE1BQU07U0FDZCxDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQ7O09BRUc7SUFDSCxNQUFNLENBQUMsdUJBQXVCLENBQzVCLFVBQWtCLEVBQ2xCLFNBQW1CLEVBQ25CLEtBQWEsRUFDYixPQUFrQztRQUVsQyxxQkFBYSxDQUFDLE1BQU0sQ0FBQztZQUNuQixHQUFHLE9BQU87WUFDVixTQUFTLEVBQUUsR0FBRyxVQUFVLGFBQWE7WUFDckMsVUFBVTtZQUNWLElBQUksRUFBRTtnQkFDSixTQUFTO2dCQUNULEtBQUs7YUFDTjtZQUNELEtBQUssRUFBRSxNQUFNO1NBQ2QsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVEOztPQUVHO0lBQ0gsTUFBTSxDQUFDLHVCQUF1QixDQUM1QixVQUFrQixFQUNsQixTQUFtQixFQUNuQixLQUFhLEVBQ2IsT0FBa0M7UUFFbEMscUJBQWEsQ0FBQyxNQUFNLENBQUM7WUFDbkIsR0FBRyxPQUFPO1lBQ1YsU0FBUyxFQUFFLEdBQUcsVUFBVSxhQUFhO1lBQ3JDLFVBQVU7WUFDVixJQUFJLEVBQUU7Z0JBQ0osU0FBUztnQkFDVCxLQUFLO2FBQ047WUFDRCxLQUFLLEVBQUUsTUFBTSxFQUFFLG9DQUFvQztTQUNwRCxDQUFDLENBQUM7SUFDTCxDQUFDO0NBRUY7QUFwSkQsd0RBb0pDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBPYnNlcnZhYmlsaXR5IGhvb2tzIGZvciBlbnRpdHkgQ1JVRCBvcGVyYXRpb25zXG4gKiBcbiAqIFRoZXNlIGNhbiBiZSBjYWxsZWQgZnJvbSBjcnVkLXNlcnZpY2UudHMgdG8gZW1pdCBvYnNlcnZhYmlsaXR5IGV2ZW50cy5cbiAqIFVzZXMgQXVkaXRPYnNlcnZlciBmb3IgZW50aXR5IGF1ZGl0cyBhbmQgU3Bhbk9ic2VydmVyIGZvciBkZXRhaWxlZCB0cmFjaW5nLlxuICogXG4gKiBOT1RFOiBNZXRob2RzIHdpbGwgYXV0by1nZW5lcmF0ZSBjb3JyZWxhdGlvbklkIGlmIG5vdCBpbiBjb250ZXh0LFxuICogbG9nZ2luZyBhIHdhcm5pbmcgdG8gZW5jb3VyYWdlIHByb3BlciBjb250ZXh0IGVzdGFibGlzaG1lbnQuXG4gKi9cblxuaW1wb3J0IHsgQXVkaXRPYnNlcnZlciB9IGZyb20gJy4vb2JzZXJ2ZXJzL2F1ZGl0JztcbmltcG9ydCB7IFNwYW5PYnNlcnZlciwgSVNwYW5PYnNlcnZlciwgU3Bhbk9wdGlvbnMgfSBmcm9tICcuL29ic2VydmVycy9zcGFuJztcblxuLyoqXG4gKiBDb250ZXh0IGZvciBDUlVEIG9wZXJhdGlvbnMgLSBjb21wYXRpYmxlIHdpdGggU3Bhbk9wdGlvbnMgYW5kIEJhc2VPYnNlcnZlck9wdGlvbnMuXG4gKiBBbGxvd3MgcGFzc2luZyBleHBsaWNpdCB0cmFjZSBjb250ZXh0IHdoZW4gbm90IHVzaW5nIEFzeW5jTG9jYWxTdG9yYWdlIGNvbnRleHQuXG4gKi9cbmV4cG9ydCB0eXBlIENydWRPYnNlcnZhYmlsaXR5Q29udGV4dCA9IFBpY2s8U3Bhbk9wdGlvbnMsICdjb3JyZWxhdGlvbklkJyB8ICdwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQnIHwgJ2NhdXNlZEJ5JyB8ICdhY3Rvcic+O1xuXG5leHBvcnQgY2xhc3MgQ3J1ZE9ic2VydmFiaWxpdHlIb29rcyB7XG4gIC8qKlxuICAgKiBFbWl0IG9ic2VydmFiaWxpdHkgZXZlbnQgZm9yIGVudGl0eSByZWFkIG9wZXJhdGlvblxuICAgKi9cbiAgc3RhdGljIGNhcHR1cmVFbnRpdHlSZWFkKFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBlbnRpdHlJZDogc3RyaW5nLFxuICAgIGNvbnRleHQ/OiBDcnVkT2JzZXJ2YWJpbGl0eUNvbnRleHQsXG4gICk6IHZvaWQge1xuICAgIEF1ZGl0T2JzZXJ2ZXIuZW50aXR5UmVhZChlbnRpdHlOYW1lLCBlbnRpdHlJZCwgY29udGV4dCk7XG4gIH1cblxuICAvKipcbiAgICogRW1pdCBvYnNlcnZhYmlsaXR5IGV2ZW50IGZvciBlbnRpdHkgY3JlYXRlIG9wZXJhdGlvblxuICAgKi9cbiAgc3RhdGljIGNhcHR1cmVFbnRpdHlDcmVhdGUoXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIGVudGl0eUlkOiBzdHJpbmcsXG4gICAgZGF0YTogdW5rbm93bixcbiAgICBjb250ZXh0PzogQ3J1ZE9ic2VydmFiaWxpdHlDb250ZXh0LFxuICApOiB2b2lkIHtcbiAgICBBdWRpdE9ic2VydmVyLmVudGl0eUNyZWF0ZShlbnRpdHlOYW1lLCBlbnRpdHlJZCwgZGF0YSwgY29udGV4dCk7XG4gIH1cblxuICAvKipcbiAgICogRW1pdCBvYnNlcnZhYmlsaXR5IGV2ZW50IGZvciBlbnRpdHkgdXBkYXRlIG9wZXJhdGlvblxuICAgKi9cbiAgc3RhdGljIGNhcHR1cmVFbnRpdHlVcGRhdGUoXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIGVudGl0eUlkOiBzdHJpbmcsXG4gICAgY2hhbmdlczogeyBiZWZvcmU/OiB1bmtub3duOyBhZnRlcj86IHVua25vd247IGRpZmY/OiB1bmtub3duIH0sXG4gICAgY29udGV4dD86IENydWRPYnNlcnZhYmlsaXR5Q29udGV4dCxcbiAgKTogdm9pZCB7XG4gICAgQXVkaXRPYnNlcnZlci5lbnRpdHlVcGRhdGUoZW50aXR5TmFtZSwgZW50aXR5SWQsIGNoYW5nZXMsIGNvbnRleHQpO1xuICB9XG5cbiAgLyoqXG4gICAqIEVtaXQgb2JzZXJ2YWJpbGl0eSBldmVudCBmb3IgZW50aXR5IGRlbGV0ZSBvcGVyYXRpb25cbiAgICovXG4gIHN0YXRpYyBjYXB0dXJlRW50aXR5RGVsZXRlKFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBlbnRpdHlJZDogc3RyaW5nLFxuICAgIGRlbGV0ZWREYXRhPzogdW5rbm93bixcbiAgICBjb250ZXh0PzogQ3J1ZE9ic2VydmFiaWxpdHlDb250ZXh0LFxuICApOiB2b2lkIHtcbiAgICBBdWRpdE9ic2VydmVyLmVudGl0eURlbGV0ZShlbnRpdHlOYW1lLCBlbnRpdHlJZCwgZGVsZXRlZERhdGEsIGNvbnRleHQpO1xuICB9XG5cbiAgLyoqXG4gICAqIEVtaXQgb2JzZXJ2YWJpbGl0eSBldmVudCBmb3IgZW50aXR5IHF1ZXJ5IG9wZXJhdGlvblxuICAgKi9cbiAgc3RhdGljIGNhcHR1cmVFbnRpdHlRdWVyeShcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgZmlsdGVyczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4gICAgcmVzdWx0Q291bnQ6IG51bWJlcixcbiAgICBjb250ZXh0PzogQ3J1ZE9ic2VydmFiaWxpdHlDb250ZXh0LFxuICApOiB2b2lkIHtcbiAgICBBdWRpdE9ic2VydmVyLmVudGl0eUxpc3QoZW50aXR5TmFtZSwgZmlsdGVycywgcmVzdWx0Q291bnQsIGNvbnRleHQpO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZSBhIHNwYW4gZm9yIGVudGl0eSBvcGVyYXRpb24gKGZvciBtb3JlIGRldGFpbGVkIHRyYWNpbmcpXG4gICAqIFxuICAgKiBAcmV0dXJucyBJU3Bhbk9ic2VydmVyIGluc3RhbmNlIGZvciB0cmFja2luZyB0aGUgb3BlcmF0aW9uLlxuICAgKiAgICAgICAgICBBdXRvLWdlbmVyYXRlcyBjb3JyZWxhdGlvbklkIGlmIG5vdCBpbiBjb250ZXh0LlxuICAgKi9cbiAgc3RhdGljIGNyZWF0ZUVudGl0eVNwYW4oXG4gICAgb3BlcmF0aW9uOiBzdHJpbmcsXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIGNvbnRleHQ/OiBDcnVkT2JzZXJ2YWJpbGl0eUNvbnRleHQsXG4gICk6IElTcGFuT2JzZXJ2ZXIge1xuICAgIHJldHVybiBTcGFuT2JzZXJ2ZXIuc3RhcnQoYCR7ZW50aXR5TmFtZX0uJHtvcGVyYXRpb259YCwge1xuICAgICAgLi4uY29udGV4dCxcbiAgICAgIGxldmVsOiAnZGVidWcnLFxuICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAnZW50aXR5Lm5hbWUnOiBlbnRpdHlOYW1lLFxuICAgICAgICAnZW50aXR5Lm9wZXJhdGlvbic6IG9wZXJhdGlvbixcbiAgICAgIH0sXG4gICAgfSk7XG4gIH1cblxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIC8vIEJhdGNoIE9wZXJhdGlvbnNcbiAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gIC8qKlxuICAgKiBFbWl0IG9ic2VydmFiaWxpdHkgZXZlbnQgZm9yIGJ1bGsgZW50aXR5IGNyZWF0ZSBvcGVyYXRpb25cbiAgICovXG4gIHN0YXRpYyBjYXB0dXJlRW50aXR5QnVsa0NyZWF0ZShcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgZW50aXR5SWRzOiBzdHJpbmdbXSxcbiAgICBjb3VudDogbnVtYmVyLFxuICAgIGNvbnRleHQ/OiBDcnVkT2JzZXJ2YWJpbGl0eUNvbnRleHQsXG4gICk6IHZvaWQge1xuICAgIEF1ZGl0T2JzZXJ2ZXIucmVjb3JkKHtcbiAgICAgIC4uLmNvbnRleHQsXG4gICAgICBvcGVyYXRpb246IGAke2VudGl0eU5hbWV9LmJ1bGtDcmVhdGVgLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIGRhdGE6IHtcbiAgICAgICAgZW50aXR5SWRzLFxuICAgICAgICBjb3VudCxcbiAgICAgIH0sXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEVtaXQgb2JzZXJ2YWJpbGl0eSBldmVudCBmb3IgYnVsayBlbnRpdHkgdXBkYXRlIG9wZXJhdGlvblxuICAgKi9cbiAgc3RhdGljIGNhcHR1cmVFbnRpdHlCdWxrVXBkYXRlKFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBlbnRpdHlJZHM6IHN0cmluZ1tdLFxuICAgIGNvdW50OiBudW1iZXIsXG4gICAgY29udGV4dD86IENydWRPYnNlcnZhYmlsaXR5Q29udGV4dCxcbiAgKTogdm9pZCB7XG4gICAgQXVkaXRPYnNlcnZlci5yZWNvcmQoe1xuICAgICAgLi4uY29udGV4dCxcbiAgICAgIG9wZXJhdGlvbjogYCR7ZW50aXR5TmFtZX0uYnVsa1VwZGF0ZWAsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgZGF0YToge1xuICAgICAgICBlbnRpdHlJZHMsXG4gICAgICAgIGNvdW50LFxuICAgICAgfSxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogRW1pdCBvYnNlcnZhYmlsaXR5IGV2ZW50IGZvciBidWxrIGVudGl0eSBkZWxldGUgb3BlcmF0aW9uXG4gICAqL1xuICBzdGF0aWMgY2FwdHVyZUVudGl0eUJ1bGtEZWxldGUoXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIGVudGl0eUlkczogc3RyaW5nW10sXG4gICAgY291bnQ6IG51bWJlcixcbiAgICBjb250ZXh0PzogQ3J1ZE9ic2VydmFiaWxpdHlDb250ZXh0LFxuICApOiB2b2lkIHtcbiAgICBBdWRpdE9ic2VydmVyLnJlY29yZCh7XG4gICAgICAuLi5jb250ZXh0LFxuICAgICAgb3BlcmF0aW9uOiBgJHtlbnRpdHlOYW1lfS5idWxrRGVsZXRlYCxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBkYXRhOiB7XG4gICAgICAgIGVudGl0eUlkcyxcbiAgICAgICAgY291bnQsXG4gICAgICB9LFxuICAgICAgbGV2ZWw6ICd3YXJuJywgLy8gQnVsayBkZWxldGVzIGFyZSBtb3JlIHNpZ25pZmljYW50XG4gICAgfSk7XG4gIH1cblxufVxuIl19