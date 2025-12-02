"use strict";
/**
 * Observability hooks for entity CRUD operations
 *
 * These can be called from crud-service.ts to emit observability events.
 * Uses AuditObserver for entity audits and SpanObserver for detailed tracing.
 *
 * NOTE: All methods require a correlationId in the context. Without it,
 * they will log a warning and skip the observability event.
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
        if (!context?.correlationId) {
            logger.debug(`captureEntityRead(${entityName}): No correlationId, skipping audit`);
            return;
        }
        audit_1.AuditObserver.entityRead(entityName, entityId, {
            correlationId: context.correlationId,
            actor: context.actor,
        });
    }
    /**
     * Emit observability event for entity create operation
     */
    static captureEntityCreate(entityName, entityId, data, context) {
        if (!context?.correlationId) {
            logger.debug(`captureEntityCreate(${entityName}): No correlationId, skipping audit`);
            return;
        }
        audit_1.AuditObserver.entityCreate(entityName, entityId, data, {
            correlationId: context.correlationId,
            actor: context.actor,
        });
    }
    /**
     * Emit observability event for entity update operation
     */
    static captureEntityUpdate(entityName, entityId, changes, context) {
        if (!context?.correlationId) {
            logger.debug(`captureEntityUpdate(${entityName}): No correlationId, skipping audit`);
            return;
        }
        audit_1.AuditObserver.entityUpdate(entityName, entityId, changes, {
            correlationId: context.correlationId,
            actor: context.actor,
        });
    }
    /**
     * Emit observability event for entity delete operation
     */
    static captureEntityDelete(entityName, entityId, deletedData, context) {
        if (!context?.correlationId) {
            logger.debug(`captureEntityDelete(${entityName}): No correlationId, skipping audit`);
            return;
        }
        audit_1.AuditObserver.entityDelete(entityName, entityId, deletedData, {
            correlationId: context.correlationId,
            actor: context.actor,
        });
    }
    /**
     * Emit observability event for entity query operation
     */
    static captureEntityQuery(entityName, filters, resultCount, context) {
        if (!context?.correlationId) {
            logger.debug(`captureEntityQuery(${entityName}): No correlationId, skipping audit`);
            return;
        }
        audit_1.AuditObserver.entityList(entityName, filters, resultCount, {
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
    static createEntitySpan(operation, entityName, context) {
        if (!context?.correlationId) {
            logger.debug(`createEntitySpan(${entityName}.${operation}): No correlationId, returning NoOp span`);
        }
        return span_1.SpanObserver.start(`${entityName}.${operation}`, {
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
    static captureEntityBulkCreate(entityName, entityIds, count, context) {
        if (!context?.correlationId) {
            logger.debug(`captureEntityBulkCreate(${entityName}): No correlationId, skipping audit`);
            return;
        }
        audit_1.AuditObserver.record({
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
    static captureEntityBulkUpdate(entityName, entityIds, count, context) {
        if (!context?.correlationId) {
            logger.debug(`captureEntityBulkUpdate(${entityName}): No correlationId, skipping audit`);
            return;
        }
        audit_1.AuditObserver.record({
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
    static captureEntityBulkDelete(entityName, entityIds, count, context) {
        if (!context?.correlationId) {
            logger.debug(`captureEntityBulkDelete(${entityName}): No correlationId, skipping audit`);
            return;
        }
        audit_1.AuditObserver.record({
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
    static captureEntityList(entityName, filters, resultCount, context) {
        return this.captureEntityQuery(entityName, filters, resultCount, context);
    }
}
exports.CrudObservabilityHooks = CrudObservabilityHooks;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3J1ZC1ob29rcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2NydWQtaG9va3MudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7OztHQVFHOzs7QUFHSCw2Q0FBa0Q7QUFDbEQsMkNBQStEO0FBQy9ELHdDQUEwQztBQUUxQyxNQUFNLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsd0JBQXdCLENBQUMsQ0FBQztBQVF0RCxNQUFhLHNCQUFzQjtJQUNqQzs7T0FFRztJQUNILE1BQU0sQ0FBQyxpQkFBaUIsQ0FDdEIsVUFBa0IsRUFDbEIsUUFBZ0IsRUFDaEIsT0FBa0M7UUFFbEMsSUFBSSxDQUFDLE9BQU8sRUFBRSxhQUFhLEVBQUUsQ0FBQztZQUM1QixNQUFNLENBQUMsS0FBSyxDQUFDLHFCQUFxQixVQUFVLHFDQUFxQyxDQUFDLENBQUM7WUFDbkYsT0FBTztRQUNULENBQUM7UUFDRCxxQkFBYSxDQUFDLFVBQVUsQ0FBQyxVQUFVLEVBQUUsUUFBUSxFQUFFO1lBQzdDLGFBQWEsRUFBRSxPQUFPLENBQUMsYUFBYTtZQUNwQyxLQUFLLEVBQUUsT0FBTyxDQUFDLEtBQUs7U0FDckIsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVEOztPQUVHO0lBQ0gsTUFBTSxDQUFDLG1CQUFtQixDQUN4QixVQUFrQixFQUNsQixRQUFnQixFQUNoQixJQUFhLEVBQ2IsT0FBa0M7UUFFbEMsSUFBSSxDQUFDLE9BQU8sRUFBRSxhQUFhLEVBQUUsQ0FBQztZQUM1QixNQUFNLENBQUMsS0FBSyxDQUFDLHVCQUF1QixVQUFVLHFDQUFxQyxDQUFDLENBQUM7WUFDckYsT0FBTztRQUNULENBQUM7UUFDRCxxQkFBYSxDQUFDLFlBQVksQ0FBQyxVQUFVLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRTtZQUNyRCxhQUFhLEVBQUUsT0FBTyxDQUFDLGFBQWE7WUFDcEMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxLQUFLO1NBQ3JC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LE1BQU0sRUFBRSxvQ0FBb0M7WUFDbkQsYUFBYSxFQUFFLE9BQU8sQ0FBQyxhQUFhO1lBQ3BDLEtBQUssRUFBRSxPQUFPLENBQUMsS0FBSztTQUNyQixDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQsK0VBQStFO0lBQy9FLFVBQVU7SUFDViwrRUFBK0U7SUFFL0U7O09BRUc7SUFDSCxNQUFNLENBQUMsaUJBQWlCLENBQ3RCLFVBQWtCLEVBQ2xCLE9BQWdDLEVBQ2hDLFdBQW1CLEVBQ25CLE9BQWtDO1FBRWxDLE9BQU8sSUFBSSxDQUFDLGtCQUFrQixDQUFDLFVBQVUsRUFBRSxPQUFPLEVBQUUsV0FBVyxFQUFFLE9BQU8sQ0FBQyxDQUFDO0lBQzVFLENBQUM7Q0FDRjtBQTNORCx3REEyTkMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIE9ic2VydmFiaWxpdHkgaG9va3MgZm9yIGVudGl0eSBDUlVEIG9wZXJhdGlvbnNcbiAqIFxuICogVGhlc2UgY2FuIGJlIGNhbGxlZCBmcm9tIGNydWQtc2VydmljZS50cyB0byBlbWl0IG9ic2VydmFiaWxpdHkgZXZlbnRzLlxuICogVXNlcyBBdWRpdE9ic2VydmVyIGZvciBlbnRpdHkgYXVkaXRzIGFuZCBTcGFuT2JzZXJ2ZXIgZm9yIGRldGFpbGVkIHRyYWNpbmcuXG4gKiBcbiAqIE5PVEU6IEFsbCBtZXRob2RzIHJlcXVpcmUgYSBjb3JyZWxhdGlvbklkIGluIHRoZSBjb250ZXh0LiBXaXRob3V0IGl0LFxuICogdGhleSB3aWxsIGxvZyBhIHdhcm5pbmcgYW5kIHNraXAgdGhlIG9ic2VydmFiaWxpdHkgZXZlbnQuXG4gKi9cblxuaW1wb3J0IHsgQWN0b3IgfSBmcm9tICcuLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IEF1ZGl0T2JzZXJ2ZXIgfSBmcm9tICcuL29ic2VydmVycy9hdWRpdCc7XG5pbXBvcnQgeyBTcGFuT2JzZXJ2ZXIsIElTcGFuT2JzZXJ2ZXIgfSBmcm9tICcuL29ic2VydmVycy9zcGFuJztcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4uL2xvZ2dpbmcnO1xuXG5jb25zdCBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ0NydWRPYnNlcnZhYmlsaXR5SG9va3MnKTtcblxuZXhwb3J0IGludGVyZmFjZSBDcnVkT2JzZXJ2YWJpbGl0eUNvbnRleHQge1xuICBjb3JyZWxhdGlvbklkPzogc3RyaW5nO1xuICBwYXJlbnRMb2dJZD86IHN0cmluZztcbiAgYWN0b3I/OiBBY3Rvcjtcbn1cblxuZXhwb3J0IGNsYXNzIENydWRPYnNlcnZhYmlsaXR5SG9va3Mge1xuICAvKipcbiAgICogRW1pdCBvYnNlcnZhYmlsaXR5IGV2ZW50IGZvciBlbnRpdHkgcmVhZCBvcGVyYXRpb25cbiAgICovXG4gIHN0YXRpYyBjYXB0dXJlRW50aXR5UmVhZChcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgZW50aXR5SWQ6IHN0cmluZyxcbiAgICBjb250ZXh0PzogQ3J1ZE9ic2VydmFiaWxpdHlDb250ZXh0LFxuICApOiB2b2lkIHtcbiAgICBpZiAoIWNvbnRleHQ/LmNvcnJlbGF0aW9uSWQpIHtcbiAgICAgIGxvZ2dlci5kZWJ1ZyhgY2FwdHVyZUVudGl0eVJlYWQoJHtlbnRpdHlOYW1lfSk6IE5vIGNvcnJlbGF0aW9uSWQsIHNraXBwaW5nIGF1ZGl0YCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIEF1ZGl0T2JzZXJ2ZXIuZW50aXR5UmVhZChlbnRpdHlOYW1lLCBlbnRpdHlJZCwge1xuICAgICAgY29ycmVsYXRpb25JZDogY29udGV4dC5jb3JyZWxhdGlvbklkLFxuICAgICAgYWN0b3I6IGNvbnRleHQuYWN0b3IsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogRW1pdCBvYnNlcnZhYmlsaXR5IGV2ZW50IGZvciBlbnRpdHkgY3JlYXRlIG9wZXJhdGlvblxuICAgKi9cbiAgc3RhdGljIGNhcHR1cmVFbnRpdHlDcmVhdGUoXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIGVudGl0eUlkOiBzdHJpbmcsXG4gICAgZGF0YTogdW5rbm93bixcbiAgICBjb250ZXh0PzogQ3J1ZE9ic2VydmFiaWxpdHlDb250ZXh0LFxuICApOiB2b2lkIHtcbiAgICBpZiAoIWNvbnRleHQ/LmNvcnJlbGF0aW9uSWQpIHtcbiAgICAgIGxvZ2dlci5kZWJ1ZyhgY2FwdHVyZUVudGl0eUNyZWF0ZSgke2VudGl0eU5hbWV9KTogTm8gY29ycmVsYXRpb25JZCwgc2tpcHBpbmcgYXVkaXRgKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgQXVkaXRPYnNlcnZlci5lbnRpdHlDcmVhdGUoZW50aXR5TmFtZSwgZW50aXR5SWQsIGRhdGEsIHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IGNvbnRleHQuY29ycmVsYXRpb25JZCxcbiAgICAgIGFjdG9yOiBjb250ZXh0LmFjdG9yLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEVtaXQgb2JzZXJ2YWJpbGl0eSBldmVudCBmb3IgZW50aXR5IHVwZGF0ZSBvcGVyYXRpb25cbiAgICovXG4gIHN0YXRpYyBjYXB0dXJlRW50aXR5VXBkYXRlKFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBlbnRpdHlJZDogc3RyaW5nLFxuICAgIGNoYW5nZXM6IHsgYmVmb3JlPzogdW5rbm93bjsgYWZ0ZXI/OiB1bmtub3duOyBkaWZmPzogdW5rbm93biB9LFxuICAgIGNvbnRleHQ/OiBDcnVkT2JzZXJ2YWJpbGl0eUNvbnRleHQsXG4gICk6IHZvaWQge1xuICAgIGlmICghY29udGV4dD8uY29ycmVsYXRpb25JZCkge1xuICAgICAgbG9nZ2VyLmRlYnVnKGBjYXB0dXJlRW50aXR5VXBkYXRlKCR7ZW50aXR5TmFtZX0pOiBObyBjb3JyZWxhdGlvbklkLCBza2lwcGluZyBhdWRpdGApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBBdWRpdE9ic2VydmVyLmVudGl0eVVwZGF0ZShlbnRpdHlOYW1lLCBlbnRpdHlJZCwgY2hhbmdlcywge1xuICAgICAgY29ycmVsYXRpb25JZDogY29udGV4dC5jb3JyZWxhdGlvbklkLFxuICAgICAgYWN0b3I6IGNvbnRleHQuYWN0b3IsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogRW1pdCBvYnNlcnZhYmlsaXR5IGV2ZW50IGZvciBlbnRpdHkgZGVsZXRlIG9wZXJhdGlvblxuICAgKi9cbiAgc3RhdGljIGNhcHR1cmVFbnRpdHlEZWxldGUoXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIGVudGl0eUlkOiBzdHJpbmcsXG4gICAgZGVsZXRlZERhdGE/OiB1bmtub3duLFxuICAgIGNvbnRleHQ/OiBDcnVkT2JzZXJ2YWJpbGl0eUNvbnRleHQsXG4gICk6IHZvaWQge1xuICAgIGlmICghY29udGV4dD8uY29ycmVsYXRpb25JZCkge1xuICAgICAgbG9nZ2VyLmRlYnVnKGBjYXB0dXJlRW50aXR5RGVsZXRlKCR7ZW50aXR5TmFtZX0pOiBObyBjb3JyZWxhdGlvbklkLCBza2lwcGluZyBhdWRpdGApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBBdWRpdE9ic2VydmVyLmVudGl0eURlbGV0ZShlbnRpdHlOYW1lLCBlbnRpdHlJZCwgZGVsZXRlZERhdGEsIHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IGNvbnRleHQuY29ycmVsYXRpb25JZCxcbiAgICAgIGFjdG9yOiBjb250ZXh0LmFjdG9yLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEVtaXQgb2JzZXJ2YWJpbGl0eSBldmVudCBmb3IgZW50aXR5IHF1ZXJ5IG9wZXJhdGlvblxuICAgKi9cbiAgc3RhdGljIGNhcHR1cmVFbnRpdHlRdWVyeShcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgZmlsdGVyczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4gICAgcmVzdWx0Q291bnQ6IG51bWJlcixcbiAgICBjb250ZXh0PzogQ3J1ZE9ic2VydmFiaWxpdHlDb250ZXh0LFxuICApOiB2b2lkIHtcbiAgICBpZiAoIWNvbnRleHQ/LmNvcnJlbGF0aW9uSWQpIHtcbiAgICAgIGxvZ2dlci5kZWJ1ZyhgY2FwdHVyZUVudGl0eVF1ZXJ5KCR7ZW50aXR5TmFtZX0pOiBObyBjb3JyZWxhdGlvbklkLCBza2lwcGluZyBhdWRpdGApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBBdWRpdE9ic2VydmVyLmVudGl0eUxpc3QoZW50aXR5TmFtZSwgZmlsdGVycywgcmVzdWx0Q291bnQsIHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IGNvbnRleHQuY29ycmVsYXRpb25JZCxcbiAgICAgIGFjdG9yOiBjb250ZXh0LmFjdG9yLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZSBhIHNwYW4gZm9yIGVudGl0eSBvcGVyYXRpb24gKGZvciBtb3JlIGRldGFpbGVkIHRyYWNpbmcpXG4gICAqIFxuICAgKiBAcmV0dXJucyBJU3Bhbk9ic2VydmVyIGluc3RhbmNlIGZvciB0cmFja2luZyB0aGUgb3BlcmF0aW9uLlxuICAgKiAgICAgICAgICBSZXR1cm5zIE5vT3Agc3BhbiBpZiBubyBjb3JyZWxhdGlvbklkICh3aWxsIGxvZyBkZWJ1ZyB3YXJuaW5nKS5cbiAgICovXG4gIHN0YXRpYyBjcmVhdGVFbnRpdHlTcGFuKFxuICAgIG9wZXJhdGlvbjogc3RyaW5nLFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBjb250ZXh0PzogQ3J1ZE9ic2VydmFiaWxpdHlDb250ZXh0LFxuICApOiBJU3Bhbk9ic2VydmVyIHtcbiAgICBpZiAoIWNvbnRleHQ/LmNvcnJlbGF0aW9uSWQpIHtcbiAgICAgIGxvZ2dlci5kZWJ1ZyhgY3JlYXRlRW50aXR5U3Bhbigke2VudGl0eU5hbWV9LiR7b3BlcmF0aW9ufSk6IE5vIGNvcnJlbGF0aW9uSWQsIHJldHVybmluZyBOb09wIHNwYW5gKTtcbiAgICB9XG4gICAgcmV0dXJuIFNwYW5PYnNlcnZlci5zdGFydChgJHtlbnRpdHlOYW1lfS4ke29wZXJhdGlvbn1gLCB7XG4gICAgICBjb3JyZWxhdGlvbklkOiBjb250ZXh0Py5jb3JyZWxhdGlvbklkLFxuICAgICAgLy8gTm90ZTogcGFyZW50U3BhbklkIG1hcHMgdG8gcGFyZW50TG9nSWQgaW4gdGhlIGNvbnRleHRcbiAgICAgIHBhcmVudFNwYW5JZDogY29udGV4dD8ucGFyZW50TG9nSWQsXG4gICAgICBsZXZlbDogJ2RlYnVnJyxcbiAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgJ2VudGl0eS5uYW1lJzogZW50aXR5TmFtZSxcbiAgICAgICAgJ2VudGl0eS5vcGVyYXRpb24nOiBvcGVyYXRpb24sXG4gICAgICB9LFxuICAgICAgYWN0b3I6IGNvbnRleHQ/LmFjdG9yLFxuICAgIH0pO1xuICB9XG5cbiAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAvLyBCYXRjaCBPcGVyYXRpb25zXG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAvKipcbiAgICogRW1pdCBvYnNlcnZhYmlsaXR5IGV2ZW50IGZvciBidWxrIGVudGl0eSBjcmVhdGUgb3BlcmF0aW9uXG4gICAqL1xuICBzdGF0aWMgY2FwdHVyZUVudGl0eUJ1bGtDcmVhdGUoXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIGVudGl0eUlkczogc3RyaW5nW10sXG4gICAgY291bnQ6IG51bWJlcixcbiAgICBjb250ZXh0PzogQ3J1ZE9ic2VydmFiaWxpdHlDb250ZXh0LFxuICApOiB2b2lkIHtcbiAgICBpZiAoIWNvbnRleHQ/LmNvcnJlbGF0aW9uSWQpIHtcbiAgICAgIGxvZ2dlci5kZWJ1ZyhgY2FwdHVyZUVudGl0eUJ1bGtDcmVhdGUoJHtlbnRpdHlOYW1lfSk6IE5vIGNvcnJlbGF0aW9uSWQsIHNraXBwaW5nIGF1ZGl0YCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIEF1ZGl0T2JzZXJ2ZXIucmVjb3JkKHtcbiAgICAgIG9wZXJhdGlvbjogYCR7ZW50aXR5TmFtZX0uYnVsa0NyZWF0ZWAsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgZGF0YToge1xuICAgICAgICBlbnRpdHlJZHMsXG4gICAgICAgIGNvdW50LFxuICAgICAgfSxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBjb3JyZWxhdGlvbklkOiBjb250ZXh0LmNvcnJlbGF0aW9uSWQsXG4gICAgICBhY3RvcjogY29udGV4dC5hY3RvcixcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFbWl0IG9ic2VydmFiaWxpdHkgZXZlbnQgZm9yIGJ1bGsgZW50aXR5IHVwZGF0ZSBvcGVyYXRpb25cbiAgICovXG4gIHN0YXRpYyBjYXB0dXJlRW50aXR5QnVsa1VwZGF0ZShcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgZW50aXR5SWRzOiBzdHJpbmdbXSxcbiAgICBjb3VudDogbnVtYmVyLFxuICAgIGNvbnRleHQ/OiBDcnVkT2JzZXJ2YWJpbGl0eUNvbnRleHQsXG4gICk6IHZvaWQge1xuICAgIGlmICghY29udGV4dD8uY29ycmVsYXRpb25JZCkge1xuICAgICAgbG9nZ2VyLmRlYnVnKGBjYXB0dXJlRW50aXR5QnVsa1VwZGF0ZSgke2VudGl0eU5hbWV9KTogTm8gY29ycmVsYXRpb25JZCwgc2tpcHBpbmcgYXVkaXRgKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgQXVkaXRPYnNlcnZlci5yZWNvcmQoe1xuICAgICAgb3BlcmF0aW9uOiBgJHtlbnRpdHlOYW1lfS5idWxrVXBkYXRlYCxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBkYXRhOiB7XG4gICAgICAgIGVudGl0eUlkcyxcbiAgICAgICAgY291bnQsXG4gICAgICB9LFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IGNvbnRleHQuY29ycmVsYXRpb25JZCxcbiAgICAgIGFjdG9yOiBjb250ZXh0LmFjdG9yLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEVtaXQgb2JzZXJ2YWJpbGl0eSBldmVudCBmb3IgYnVsayBlbnRpdHkgZGVsZXRlIG9wZXJhdGlvblxuICAgKi9cbiAgc3RhdGljIGNhcHR1cmVFbnRpdHlCdWxrRGVsZXRlKFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBlbnRpdHlJZHM6IHN0cmluZ1tdLFxuICAgIGNvdW50OiBudW1iZXIsXG4gICAgY29udGV4dD86IENydWRPYnNlcnZhYmlsaXR5Q29udGV4dCxcbiAgKTogdm9pZCB7XG4gICAgaWYgKCFjb250ZXh0Py5jb3JyZWxhdGlvbklkKSB7XG4gICAgICBsb2dnZXIuZGVidWcoYGNhcHR1cmVFbnRpdHlCdWxrRGVsZXRlKCR7ZW50aXR5TmFtZX0pOiBObyBjb3JyZWxhdGlvbklkLCBza2lwcGluZyBhdWRpdGApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBBdWRpdE9ic2VydmVyLnJlY29yZCh7XG4gICAgICBvcGVyYXRpb246IGAke2VudGl0eU5hbWV9LmJ1bGtEZWxldGVgLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIGRhdGE6IHtcbiAgICAgICAgZW50aXR5SWRzLFxuICAgICAgICBjb3VudCxcbiAgICAgIH0sXG4gICAgICBsZXZlbDogJ3dhcm4nLCAvLyBCdWxrIGRlbGV0ZXMgYXJlIG1vcmUgc2lnbmlmaWNhbnRcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IGNvbnRleHQuY29ycmVsYXRpb25JZCxcbiAgICAgIGFjdG9yOiBjb250ZXh0LmFjdG9yLFxuICAgIH0pO1xuICB9XG5cbiAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAvLyBBbGlhc2VzXG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAvKipcbiAgICogQWxpYXMgZm9yIGNhcHR1cmVFbnRpdHlRdWVyeSBmb3IgY29uc2lzdGVudCBuYW1pbmdcbiAgICovXG4gIHN0YXRpYyBjYXB0dXJlRW50aXR5TGlzdChcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgZmlsdGVyczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4gICAgcmVzdWx0Q291bnQ6IG51bWJlcixcbiAgICBjb250ZXh0PzogQ3J1ZE9ic2VydmFiaWxpdHlDb250ZXh0LFxuICApOiB2b2lkIHtcbiAgICByZXR1cm4gdGhpcy5jYXB0dXJlRW50aXR5UXVlcnkoZW50aXR5TmFtZSwgZmlsdGVycywgcmVzdWx0Q291bnQsIGNvbnRleHQpO1xuICB9XG59XG4iXX0=