"use strict";
/**
 * Observability hooks for entity CRUD operations
 *
 * These can be called from crud-service.ts to emit observability events.
 * Uses AuditObserver for entity audits.
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
    static wrapEntityOperation(operation, entityName, fn, context) {
        return span_1.SpanObserver.wrap(`${entityName}.${operation}`, fn, {
            ...context,
            level: 'debug',
            tags: {
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
            data: { entityIds, count },
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
            data: { entityIds, count },
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
            data: { entityIds, count },
            level: 'warn',
        });
    }
}
exports.CrudObservabilityHooks = CrudObservabilityHooks;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3J1ZC1ob29rcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2NydWQtaG9va3MudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7OztHQUtHOzs7QUFFSCw2Q0FBa0Q7QUFDbEQsMkNBQTZEO0FBUTdELE1BQWEsc0JBQXNCO0lBQ2pDOztPQUVHO0lBQ0gsTUFBTSxDQUFDLGlCQUFpQixDQUN0QixVQUFrQixFQUNsQixRQUFnQixFQUNoQixPQUFrQztRQUVsQyxxQkFBYSxDQUFDLFVBQVUsQ0FBQyxVQUFVLEVBQUUsUUFBUSxFQUFFLE9BQU8sQ0FBQyxDQUFDO0lBQzFELENBQUM7SUFFRDs7T0FFRztJQUNILE1BQU0sQ0FBQyxtQkFBbUIsQ0FDeEIsVUFBa0IsRUFDbEIsUUFBZ0IsRUFDaEIsSUFBYSxFQUNiLE9BQWtDO1FBRWxDLHFCQUFhLENBQUMsWUFBWSxDQUFDLFVBQVUsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLE9BQU8sQ0FBQyxDQUFDO0lBQ2xFLENBQUM7SUFFRDs7T0FFRztJQUNILE1BQU0sQ0FBQyxtQkFBbUIsQ0FDeEIsVUFBa0IsRUFDbEIsUUFBZ0IsRUFDaEIsT0FBOEQsRUFDOUQsT0FBa0M7UUFFbEMscUJBQWEsQ0FBQyxZQUFZLENBQUMsVUFBVSxFQUFFLFFBQVEsRUFBRSxPQUFPLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFDckUsQ0FBQztJQUVEOztPQUVHO0lBQ0gsTUFBTSxDQUFDLG1CQUFtQixDQUN4QixVQUFrQixFQUNsQixRQUFnQixFQUNoQixXQUFxQixFQUNyQixPQUFrQztRQUVsQyxxQkFBYSxDQUFDLFlBQVksQ0FBQyxVQUFVLEVBQUUsUUFBUSxFQUFFLFdBQVcsRUFBRSxPQUFPLENBQUMsQ0FBQztJQUN6RSxDQUFDO0lBRUQ7O09BRUc7SUFDSCxNQUFNLENBQUMsa0JBQWtCLENBQ3ZCLFVBQWtCLEVBQ2xCLE9BQWdDLEVBQ2hDLFdBQW1CLEVBQ25CLE9BQWtDO1FBRWxDLHFCQUFhLENBQUMsVUFBVSxDQUFDLFVBQVUsRUFBRSxPQUFPLEVBQUUsV0FBVyxFQUFFLE9BQU8sQ0FBQyxDQUFDO0lBQ3RFLENBQUM7SUFFRDs7Ozs7Ozs7Ozs7O09BWUc7SUFDSCxNQUFNLENBQUMsbUJBQW1CLENBQ3hCLFNBQWlCLEVBQ2pCLFVBQWtCLEVBQ2xCLEVBQVcsRUFDWCxPQUFrQztRQUVsQyxPQUFPLG1CQUFZLENBQUMsSUFBSSxDQUN0QixHQUFHLFVBQVUsSUFBSSxTQUFTLEVBQUUsRUFDNUIsRUFBRSxFQUNGO1lBQ0UsR0FBRyxPQUFPO1lBQ1YsS0FBSyxFQUFFLE9BQU87WUFDZCxJQUFJLEVBQUU7Z0JBQ0osYUFBYSxFQUFFLFVBQVU7Z0JBQ3pCLGtCQUFrQixFQUFFLFNBQVM7YUFDOUI7U0FDRixDQUNGLENBQUM7SUFDSixDQUFDO0lBRUQsK0VBQStFO0lBQy9FLG1CQUFtQjtJQUNuQiwrRUFBK0U7SUFFL0U7O09BRUc7SUFDSCxNQUFNLENBQUMsdUJBQXVCLENBQzVCLFVBQWtCLEVBQ2xCLFNBQW1CLEVBQ25CLEtBQWEsRUFDYixPQUFrQztRQUVsQyxxQkFBYSxDQUFDLE1BQU0sQ0FBQztZQUNuQixHQUFHLE9BQU87WUFDVixTQUFTLEVBQUUsR0FBRyxVQUFVLGFBQWE7WUFDckMsVUFBVTtZQUNWLElBQUksRUFBRSxFQUFFLFNBQVMsRUFBRSxLQUFLLEVBQUU7WUFDMUIsS0FBSyxFQUFFLE1BQU07U0FDZCxDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQ7O09BRUc7SUFDSCxNQUFNLENBQUMsdUJBQXVCLENBQzVCLFVBQWtCLEVBQ2xCLFNBQW1CLEVBQ25CLEtBQWEsRUFDYixPQUFrQztRQUVsQyxxQkFBYSxDQUFDLE1BQU0sQ0FBQztZQUNuQixHQUFHLE9BQU87WUFDVixTQUFTLEVBQUUsR0FBRyxVQUFVLGFBQWE7WUFDckMsVUFBVTtZQUNWLElBQUksRUFBRSxFQUFFLFNBQVMsRUFBRSxLQUFLLEVBQUU7WUFDMUIsS0FBSyxFQUFFLE1BQU07U0FDZCxDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQ7O09BRUc7SUFDSCxNQUFNLENBQUMsdUJBQXVCLENBQzVCLFVBQWtCLEVBQ2xCLFNBQW1CLEVBQ25CLEtBQWEsRUFDYixPQUFrQztRQUVsQyxxQkFBYSxDQUFDLE1BQU0sQ0FBQztZQUNuQixHQUFHLE9BQU87WUFDVixTQUFTLEVBQUUsR0FBRyxVQUFVLGFBQWE7WUFDckMsVUFBVTtZQUNWLElBQUksRUFBRSxFQUFFLFNBQVMsRUFBRSxLQUFLLEVBQUU7WUFDMUIsS0FBSyxFQUFFLE1BQU07U0FDZCxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUF0SkQsd0RBc0pDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBPYnNlcnZhYmlsaXR5IGhvb2tzIGZvciBlbnRpdHkgQ1JVRCBvcGVyYXRpb25zXG4gKiBcbiAqIFRoZXNlIGNhbiBiZSBjYWxsZWQgZnJvbSBjcnVkLXNlcnZpY2UudHMgdG8gZW1pdCBvYnNlcnZhYmlsaXR5IGV2ZW50cy5cbiAqIFVzZXMgQXVkaXRPYnNlcnZlciBmb3IgZW50aXR5IGF1ZGl0cy5cbiAqL1xuXG5pbXBvcnQgeyBBdWRpdE9ic2VydmVyIH0gZnJvbSAnLi9vYnNlcnZlcnMvYXVkaXQnO1xuaW1wb3J0IHsgU3Bhbk9ic2VydmVyLCBTcGFuT3B0aW9ucyB9IGZyb20gJy4vb2JzZXJ2ZXJzL3NwYW4nO1xuXG4vKipcbiAqIENvbnRleHQgZm9yIENSVUQgb3BlcmF0aW9ucyAtIGNvbXBhdGlibGUgd2l0aCBTcGFuT3B0aW9ucyBhbmQgQmFzZU9ic2VydmVyT3B0aW9ucy5cbiAqIEFsbG93cyBwYXNzaW5nIGV4cGxpY2l0IHRyYWNlIGNvbnRleHQgd2hlbiBub3QgdXNpbmcgQXN5bmNMb2NhbFN0b3JhZ2UgY29udGV4dC5cbiAqL1xuZXhwb3J0IHR5cGUgQ3J1ZE9ic2VydmFiaWxpdHlDb250ZXh0ID0gUGljazxTcGFuT3B0aW9ucywgJ2NvcnJlbGF0aW9uSWQnIHwgJ2NhdXNlZEJ5JyB8ICdhY3Rvcic+O1xuXG5leHBvcnQgY2xhc3MgQ3J1ZE9ic2VydmFiaWxpdHlIb29rcyB7XG4gIC8qKlxuICAgKiBFbWl0IG9ic2VydmFiaWxpdHkgZXZlbnQgZm9yIGVudGl0eSByZWFkIG9wZXJhdGlvblxuICAgKi9cbiAgc3RhdGljIGNhcHR1cmVFbnRpdHlSZWFkKFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBlbnRpdHlJZDogc3RyaW5nLFxuICAgIGNvbnRleHQ/OiBDcnVkT2JzZXJ2YWJpbGl0eUNvbnRleHQsXG4gICk6IHZvaWQge1xuICAgIEF1ZGl0T2JzZXJ2ZXIuZW50aXR5UmVhZChlbnRpdHlOYW1lLCBlbnRpdHlJZCwgY29udGV4dCk7XG4gIH1cblxuICAvKipcbiAgICogRW1pdCBvYnNlcnZhYmlsaXR5IGV2ZW50IGZvciBlbnRpdHkgY3JlYXRlIG9wZXJhdGlvblxuICAgKi9cbiAgc3RhdGljIGNhcHR1cmVFbnRpdHlDcmVhdGUoXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIGVudGl0eUlkOiBzdHJpbmcsXG4gICAgZGF0YTogdW5rbm93bixcbiAgICBjb250ZXh0PzogQ3J1ZE9ic2VydmFiaWxpdHlDb250ZXh0LFxuICApOiB2b2lkIHtcbiAgICBBdWRpdE9ic2VydmVyLmVudGl0eUNyZWF0ZShlbnRpdHlOYW1lLCBlbnRpdHlJZCwgZGF0YSwgY29udGV4dCk7XG4gIH1cblxuICAvKipcbiAgICogRW1pdCBvYnNlcnZhYmlsaXR5IGV2ZW50IGZvciBlbnRpdHkgdXBkYXRlIG9wZXJhdGlvblxuICAgKi9cbiAgc3RhdGljIGNhcHR1cmVFbnRpdHlVcGRhdGUoXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIGVudGl0eUlkOiBzdHJpbmcsXG4gICAgY2hhbmdlczogeyBiZWZvcmU/OiB1bmtub3duOyBhZnRlcj86IHVua25vd247IGRpZmY/OiB1bmtub3duIH0sXG4gICAgY29udGV4dD86IENydWRPYnNlcnZhYmlsaXR5Q29udGV4dCxcbiAgKTogdm9pZCB7XG4gICAgQXVkaXRPYnNlcnZlci5lbnRpdHlVcGRhdGUoZW50aXR5TmFtZSwgZW50aXR5SWQsIGNoYW5nZXMsIGNvbnRleHQpO1xuICB9XG5cbiAgLyoqXG4gICAqIEVtaXQgb2JzZXJ2YWJpbGl0eSBldmVudCBmb3IgZW50aXR5IGRlbGV0ZSBvcGVyYXRpb25cbiAgICovXG4gIHN0YXRpYyBjYXB0dXJlRW50aXR5RGVsZXRlKFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBlbnRpdHlJZDogc3RyaW5nLFxuICAgIGRlbGV0ZWREYXRhPzogdW5rbm93bixcbiAgICBjb250ZXh0PzogQ3J1ZE9ic2VydmFiaWxpdHlDb250ZXh0LFxuICApOiB2b2lkIHtcbiAgICBBdWRpdE9ic2VydmVyLmVudGl0eURlbGV0ZShlbnRpdHlOYW1lLCBlbnRpdHlJZCwgZGVsZXRlZERhdGEsIGNvbnRleHQpO1xuICB9XG5cbiAgLyoqXG4gICAqIEVtaXQgb2JzZXJ2YWJpbGl0eSBldmVudCBmb3IgZW50aXR5IHF1ZXJ5IG9wZXJhdGlvblxuICAgKi9cbiAgc3RhdGljIGNhcHR1cmVFbnRpdHlRdWVyeShcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgZmlsdGVyczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4gICAgcmVzdWx0Q291bnQ6IG51bWJlcixcbiAgICBjb250ZXh0PzogQ3J1ZE9ic2VydmFiaWxpdHlDb250ZXh0LFxuICApOiB2b2lkIHtcbiAgICBBdWRpdE9ic2VydmVyLmVudGl0eUxpc3QoZW50aXR5TmFtZSwgZmlsdGVycywgcmVzdWx0Q291bnQsIGNvbnRleHQpO1xuICB9XG5cbiAgLyoqXG4gICAqIFdyYXAgYW4gZW50aXR5IG9wZXJhdGlvbiBpbiBhIHNwYW4uXG4gICAqIFVzZSBmb3IgbW9yZSBkZXRhaWxlZCB0cmFjaW5nIG9mIGVudGl0eSBvcGVyYXRpb25zLlxuICAgKiBcbiAgICogQGV4YW1wbGVcbiAgICogYGBgdHlwZXNjcmlwdFxuICAgKiBjb25zdCByZXN1bHQgPSBhd2FpdCBDcnVkT2JzZXJ2YWJpbGl0eUhvb2tzLndyYXBFbnRpdHlPcGVyYXRpb24oXG4gICAqICAgJ2ZpbmRCeUlkJyxcbiAgICogICAnT3JkZXInLFxuICAgKiAgIGFzeW5jICgpID0+IHRoaXMucmVwb3NpdG9yeS5maW5kQnlJZChpZClcbiAgICogKTtcbiAgICogYGBgXG4gICAqL1xuICBzdGF0aWMgd3JhcEVudGl0eU9wZXJhdGlvbjxUPihcbiAgICBvcGVyYXRpb246IHN0cmluZyxcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgZm46ICgpID0+IFQsXG4gICAgY29udGV4dD86IENydWRPYnNlcnZhYmlsaXR5Q29udGV4dCxcbiAgKTogVCB7XG4gICAgcmV0dXJuIFNwYW5PYnNlcnZlci53cmFwKFxuICAgICAgYCR7ZW50aXR5TmFtZX0uJHtvcGVyYXRpb259YCxcbiAgICAgIGZuLFxuICAgICAge1xuICAgICAgICAuLi5jb250ZXh0LFxuICAgICAgICBsZXZlbDogJ2RlYnVnJyxcbiAgICAgICAgdGFnczoge1xuICAgICAgICAgICdlbnRpdHkubmFtZSc6IGVudGl0eU5hbWUsXG4gICAgICAgICAgJ2VudGl0eS5vcGVyYXRpb24nOiBvcGVyYXRpb24sXG4gICAgICAgIH0sXG4gICAgICB9XG4gICAgKTtcbiAgfVxuXG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgLy8gQmF0Y2ggT3BlcmF0aW9uc1xuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgLyoqXG4gICAqIEVtaXQgb2JzZXJ2YWJpbGl0eSBldmVudCBmb3IgYnVsayBlbnRpdHkgY3JlYXRlIG9wZXJhdGlvblxuICAgKi9cbiAgc3RhdGljIGNhcHR1cmVFbnRpdHlCdWxrQ3JlYXRlKFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBlbnRpdHlJZHM6IHN0cmluZ1tdLFxuICAgIGNvdW50OiBudW1iZXIsXG4gICAgY29udGV4dD86IENydWRPYnNlcnZhYmlsaXR5Q29udGV4dCxcbiAgKTogdm9pZCB7XG4gICAgQXVkaXRPYnNlcnZlci5yZWNvcmQoe1xuICAgICAgLi4uY29udGV4dCxcbiAgICAgIG9wZXJhdGlvbjogYCR7ZW50aXR5TmFtZX0uYnVsa0NyZWF0ZWAsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgZGF0YTogeyBlbnRpdHlJZHMsIGNvdW50IH0sXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEVtaXQgb2JzZXJ2YWJpbGl0eSBldmVudCBmb3IgYnVsayBlbnRpdHkgdXBkYXRlIG9wZXJhdGlvblxuICAgKi9cbiAgc3RhdGljIGNhcHR1cmVFbnRpdHlCdWxrVXBkYXRlKFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBlbnRpdHlJZHM6IHN0cmluZ1tdLFxuICAgIGNvdW50OiBudW1iZXIsXG4gICAgY29udGV4dD86IENydWRPYnNlcnZhYmlsaXR5Q29udGV4dCxcbiAgKTogdm9pZCB7XG4gICAgQXVkaXRPYnNlcnZlci5yZWNvcmQoe1xuICAgICAgLi4uY29udGV4dCxcbiAgICAgIG9wZXJhdGlvbjogYCR7ZW50aXR5TmFtZX0uYnVsa1VwZGF0ZWAsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgZGF0YTogeyBlbnRpdHlJZHMsIGNvdW50IH0sXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEVtaXQgb2JzZXJ2YWJpbGl0eSBldmVudCBmb3IgYnVsayBlbnRpdHkgZGVsZXRlIG9wZXJhdGlvblxuICAgKi9cbiAgc3RhdGljIGNhcHR1cmVFbnRpdHlCdWxrRGVsZXRlKFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBlbnRpdHlJZHM6IHN0cmluZ1tdLFxuICAgIGNvdW50OiBudW1iZXIsXG4gICAgY29udGV4dD86IENydWRPYnNlcnZhYmlsaXR5Q29udGV4dCxcbiAgKTogdm9pZCB7XG4gICAgQXVkaXRPYnNlcnZlci5yZWNvcmQoe1xuICAgICAgLi4uY29udGV4dCxcbiAgICAgIG9wZXJhdGlvbjogYCR7ZW50aXR5TmFtZX0uYnVsa0RlbGV0ZWAsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgZGF0YTogeyBlbnRpdHlJZHMsIGNvdW50IH0sXG4gICAgICBsZXZlbDogJ3dhcm4nLFxuICAgIH0pO1xuICB9XG59XG4iXX0=